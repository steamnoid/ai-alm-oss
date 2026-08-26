import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  K8sJobSkillRunner,
  buildGenJob,
  genJobName,
  makeSkillRunner,
} from '../../src/aialm/oss/orchestrator/runner.ts';
import { claimQueued, enqueueGenerative, setExternalRef } from '../../src/aialm/oss/orchestrator/queue.ts';

const OPTS = {
  namespace: 'ai-alm-oss',
  image: 'ai-alm-oss:local',
  envSecretName: 'ai-alm-oss-env',
  dataPvcName: 'ai-alm-oss-data',
};

describe('skill runner selection', () => {
  it('defaults to subprocess', () => {
    expect(makeSkillRunner({}).kind).toBe('subprocess');
    expect(makeSkillRunner({ AIALM_SKILL_RUNNER: 'subprocess' }).kind).toBe('subprocess');
  });
  it('selects the k8s runner and derives options from env', () => {
    const r = makeSkillRunner({
      AIALM_SKILL_RUNNER: 'k8s',
      POD_NAMESPACE: 'ns1',
      AIALM_IMAGE: 'ghcr.io/x/ai-alm-oss:9',
      AIALM_ENV_SECRET: 'sec',
      AIALM_DATA_PVC: 'pvc',
      AIALM_SSH_SECRET: 'ssh',
    }) as any;
    expect(r.kind).toBe('k8s');
  });
});

describe('genJobName', () => {
  it('is DNS-1123 safe and bounded', () => {
    const n = genJobName('WELLBEINGT', 'WELLBEINGT-12');
    expect(n).toMatch(/^gen-[a-z0-9][a-z0-9-]*[a-z0-9]$/);
    expect(n.length).toBeLessThanOrEqual(63);
  });
  it('sanitizes hostile input', () => {
    const n = genJobName('A_B', '../etc/passwd');
    expect(n.startsWith('gen-a-b-etc-passwd')).toBe(true);
    expect(n).not.toContain('/');
  });
});

function fakeApi() {
  const created: Array<Record<string, any>> = [];
  let listed: Array<Record<string, any>> = [];
  return {
    created,
    setList(items: Array<Record<string, any>>) { listed = items; },
    api: {
      async createJob(_ns: string, job: Record<string, unknown>) { created.push(job as Record<string, any>); },
      async listJobs(_ns: string, _sel: string) { return listed; },
    },
  };
}

const JOB = { skill: 'aialm-oss-po-analyze', targetKey: 'WELLBEINGT-9', repoRef: '' };

describe('K8sJobSkillRunner.dispatch', () => {
  it('creates a Job with governed spec and returns its name', async () => {
    const f = fakeApi();
    const r = new K8sJobSkillRunner({ ...OPTS, api: f.api });
    const ref = await r.dispatch('WELLBEINGT', JOB);
    expect(f.created).toHaveLength(1);
    const j = f.created[0]!;
    expect(ref).toBe(j.metadata.name);
    expect(j.metadata.namespace).toBe('ai-alm-oss');
    expect(j.metadata.labels).toMatchObject({ app: 'ai-alm-oss-gen', project: 'WELLBEINGT' });
    expect(j.metadata.annotations['aialm.ai/queue-id']).toBe('aialm-oss-po-analyze#WELLBEINGT-9');
    const c = j.spec.template.spec.containers[0];
    expect(c.command).toEqual(['npx', 'opencode', 'run', 'aialm-oss-po-analyze', 'WELLBEINGT-9']);
    expect(c.envFrom).toEqual([{ secretRef: { name: 'ai-alm-oss-env' } }]);
    expect(j.spec.backoffLimit).toBe(0);
    expect(j.spec.ttlSecondsAfterFinished).toBe(3600);
    expect(j.spec.template.spec.restartPolicy).toBe('Never');
    // hardening regression guard: non-root is mandatory, but capabilities /
    // no-new-privs restrictions break opencode/bun in kind (see NOTE)
    const sc = c.securityContext;
    expect(sc.runAsNonRoot).toBe(true);
    expect(sc.allowPrivilegeEscalation).toBeUndefined();
    expect(sc.capabilities).toBeUndefined();
    // shared wave area via PVC subPath
    expect(c.volumeMounts[0]).toMatchObject({ mountPath: '/app/.work', subPath: 'work' });
    expect(j.spec.template.spec.volumes[0].persistentVolumeClaim.claimName).toBe('ai-alm-oss-data');
    // least privilege: no dedicated SA needed by agents
    expect(j.spec.template.spec.serviceAccountName).toBeUndefined();
  });
  it('mounts the SSH secret only when configured', () => {
    const withSsh = buildGenJob('WELLBEINGT', JOB, { ...OPTS, sshSecretName: 'aialm-ssh' });
    const c = (withSsh.spec as any).template.spec.containers[0];
    const mounts = c.volumeMounts.map((m: any) => m.mountPath);
    expect(mounts).toContain('/home/node/.ssh');
    expect((withSsh.spec as any).template.spec.volumes.map((v: any) => v.name)).toContain('ssh');
    const without = buildGenJob('WELLBEINGT', JOB, OPTS);
    const mounts2 = ((without.spec as any).template.spec.containers[0].volumeMounts as any[]).map((m) => m.mountPath);
    expect(mounts2).not.toContain('/home/node/.ssh');
  });
  it('mounts opencode auth via initContainer into writable XDG dir', () => {
    const withAuth = buildGenJob('WELLBEINGT', JOB, { ...OPTS, opencodeAuthSecretName: 'oc-auth' }) as any;
    const init = withAuth.spec.template.spec.initContainers;
    expect(init).toHaveLength(1);
    expect(init[0].command.join(' ')).toContain('cp /ocsecret/auth.json /xdata/share/opencode/auth.json');
    expect(withAuth.spec.template.spec.volumes.map((v: any) => v.name)).toEqual(
      expect.arrayContaining(['ocauth', 'xdata']),
    );
    // main container mounts the writable volume at ~/.local — no direct secret mount
    const c = withAuth.spec.template.spec.containers[0];
    const m = c.volumeMounts.map((x: any) => x.mountPath);
    expect(m).toContain('/home/node/.local');
    expect(m).not.toContain('/home/node/.local/share/opencode/auth.json');
    const without = buildGenJob('WELLBEINGT', JOB, OPTS) as any;
    expect(without.spec.template.spec.initContainers).toBeUndefined();
  });
  it('falls back to targetKey when repoRef is empty', async () => {
    const f = fakeApi();
    await new K8sJobSkillRunner({ ...OPTS, api: f.api }).dispatch('WIDG', JOB);
    const cmd = (f.created[0]! as any).spec.template.spec.containers[0].command;
    expect(cmd[cmd.length - 1]).toBe('WELLBEINGT-9');
  });
  it('pins the model via --model when configured', async () => {
    const f = fakeApi();
    const r = new K8sJobSkillRunner({ ...OPTS, api: f.api, model: 'opencode-go/ox-alpha-free' });
    await r.dispatch('WIDG', JOB);
    const cmd = (f.created[0]! as any).spec.template.spec.containers[0].command;
    expect(cmd).toEqual(['npx', 'opencode', 'run', '--model', 'opencode-go/ox-alpha-free', JOB.skill, JOB.targetKey]);
    const f2 = fakeApi();
    await new K8sJobSkillRunner({ ...OPTS, api: f2.api }).dispatch('WIDG', JOB);
    const cmd2 = (f2.created[0]! as any).spec.template.spec.containers[0].command;
    expect(cmd2).toEqual(['npx', 'opencode', 'run', JOB.skill, JOB.targetKey]);
  });
});

describe('K8sJobSkillRunner.reconcile', () => {
  it('maps terminal jobs to queue outcomes via annotation', async () => {
    const f = fakeApi();
    f.setList([
      {
        metadata: { name: 'gen-a', annotations: { 'aialm.ai/queue-id': 'aialm-oss-po-analyze#W-1' } },
        status: { succeeded: 1 },
      },
      {
        metadata: { name: 'gen-b', annotations: { 'aialm.ai/queue-id': 'aialm-oss-po-analyze#W-2' } },
        status: { failed: 1, conditions: [{ type: 'Failed', reason: 'BackoffLimitExceeded', message: 'boom' }] },
      },
      {
        metadata: { name: 'gen-c', annotations: { 'aialm.ai/queue-id': 'aialm-oss-po-analyze#W-3' } },
        status: { active: 1 },
      },
      { metadata: {} }, // no annotation — ignored
    ]);
    const out = await new K8sJobSkillRunner({ ...OPTS, api: f.api }).reconcile('WELLBEINGT');
    expect(out).toEqual([
      { id: 'aialm-oss-po-analyze#W-1', outcome: 'done' },
      { id: 'aialm-oss-po-analyze#W-2', outcome: 'failed', detail: 'BackoffLimitExceeded' },
    ]);
  });

  it('resolves running refs whose Job vanished as failed (no deadlock)', async () => {
    // isolated cwd for the queue file
    const tmp = mkdtempSync(join(tmpdir(), 'orch-runner-'));
    const prev = process.cwd();
    process.chdir(tmp);
    try {
      rmSync(join(tmp, 'state'), { recursive: true, force: true });
      enqueueGenerative('WIDG', { skill: 's', targetKey: 'WIDG-1', repoRef: '' });
      const [j] = claimQueued('WIDG', 5)!;
      setExternalRef('WIDG', j!.id, 'gen-deleted-job');
      const f = fakeApi();
      f.setList([]); // job was deleted / TTL-reaped
      const out = await new K8sJobSkillRunner({ ...OPTS, api: f.api }).reconcile('WIDG');
      expect(out).toEqual([{ id: j!.id, outcome: 'failed', detail: 'external job vanished: gen-deleted-job' }]);
    } finally {
      process.chdir(prev);
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
