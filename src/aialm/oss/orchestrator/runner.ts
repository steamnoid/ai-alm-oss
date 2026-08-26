import { spawn } from 'node:child_process';
import * as k8s from '@kubernetes/client-node';
import { listRunningExternal, markDone, markFailed, setExternalRef } from './queue.ts';

/**
 * SkillRunner seam — how a generative skill is executed.
 *
 *  - subprocess: `npx opencode run <skill> <arg>` in-process child (local dev,
 *    compose smoke). Blocking semantics preserved from the original poller.
 *  - k8s: one ephemeral Job per generative step (kind / cloud). The Job runs
 *    the same image; the orchestrator only creates it and reconciles outcomes
 *    each poll pass, so dispatch survives orchestrator restarts.
 *
 * Selection: AIALM_SKILL_RUNNER=subprocess|k8s (default subprocess).
 */

export interface SkillJob {
  skill: string;
  targetKey: string;
  repoRef: string;
}

export interface GenJobOutcome {
  id: string;
  outcome: 'done' | 'failed';
  detail?: string;
}

export interface K8sRunnerOptions {
  namespace: string;
  image: string;
  /** Secret mounted as env vars into every generative pod. */
  envSecretName: string;
  /** PVC holding the shared wave working area (.work). */
  dataPvcName: string;
  imagePullPolicy?: string;
  /** Optional Secret with an SSH key for fork pushes, mounted at ~/.ssh. */
  sshSecretName?: string;
  /** Optional Secret carrying opencode auth.json for LLM access in-cluster. */
  opencodeAuthSecretName?: string;
  /** Explicit model id (provider/model) so pods don't guess a default. */
  model?: string;
  /** Test seam: pre-built Kubernetes API accessor. */
  api?: K8sJobApi;
}

/** Minimal surface of the Kubernetes API the runner needs (fake-able). */
export interface K8sJobApi {
  createJob(namespace: string, job: Record<string, unknown>): Promise<unknown>;
  listJobs(namespace: string, labelSelector: string): Promise<Array<Record<string, any>>>;
}

export class SubprocessSkillRunner {
  readonly kind = 'subprocess' as const;

  /** Run one generative skill as an agent subprocess; rejects on spawn error
   * or non-zero exit so the queue records a failure instead of a phantom done. */
  run(job: SkillJob): Promise<void> {
    const arg = job.repoRef || job.targetKey;
    return new Promise((resolvePromise, rejectPromise) => {
      const child = spawn('npx', ['opencode', 'run', job.skill, arg], { stdio: 'inherit' });
      child.on('close', (code) => {
        if (code === 0) resolvePromise();
        else rejectPromise(new Error(`agent exited with code ${code}`));
      });
      child.on('error', (e) => rejectPromise(e));
    });
  }
}

const GEN_LABEL = 'ai-alm-oss-gen';

/** DNS-1123-safe job name: gen-<project>-<target>-<entropy>. */
export function genJobName(projectKey: string, targetKey: string): string {
  const slug = `${projectKey}-${targetKey}`
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
  return `gen-${slug}-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
}

export function buildGenJob(
  projectKey: string,
  job: SkillJob,
  o: K8sRunnerOptions,
): Record<string, unknown> {
  const arg = job.repoRef || job.targetKey;
  const name = genJobName(projectKey, job.targetKey);
  const runArgs = o.model
    ? ['npx', 'opencode', 'run', '--model', o.model, job.skill, arg]
    : ['npx', 'opencode', 'run', job.skill, arg];
  const volumes: Array<Record<string, unknown>> = [
    { name: 'work', persistentVolumeClaim: { claimName: o.dataPvcName } },
  ];
  const mounts: Array<Record<string, unknown>> = [
    { name: 'work', mountPath: '/app/.work', subPath: 'work' },
  ];
  if (o.sshSecretName) {
    volumes.push({ name: 'ssh', secret: { secretName: o.sshSecretName } });
    mounts.push({ name: 'ssh', mountPath: '/home/node/.ssh', readOnly: true });
  }
  let initContainers: Array<Record<string, unknown>> | undefined;
  if (o.opencodeAuthSecretName) {
    // Copy auth.json into a writable emptyDir instead of mounting the Secret
    // into $HOME: subPath/secret mounts create root-owned parents, which break
    // opencode's XDG state/log writes. The init container materializes
    // $XDG_DATA_HOME/opencode/auth.json owned by the runtime user.
    volumes.push({ name: 'ocauth', secret: { secretName: o.opencodeAuthSecretName } });
    volumes.push({ name: 'xdata', emptyDir: {} });
    initContainers = [
      {
        name: 'ocauth-init',
        image: o.image,
        imagePullPolicy: o.imagePullPolicy ?? 'IfNotPresent',
        command: ['sh', '-lc', 'mkdir -p /xdata/share/opencode && cp /ocsecret/auth.json /xdata/share/opencode/auth.json && ([ -f /ocsecret/account.json ] && cp /ocsecret/account.json /xdata/share/opencode/account.json || true)'],
        securityContext: { runAsUser: 1000, runAsGroup: 1000, allowPrivilegeEscalation: false, capabilities: { drop: ['ALL'] } },
        volumeMounts: [
          { name: 'ocauth', mountPath: '/ocsecret', readOnly: true },
          { name: 'xdata', mountPath: '/xdata' },
        ],
      },
    ];
    mounts.push({ name: 'xdata', mountPath: '/home/node/.local' });
  }
  return {
    apiVersion: 'batch/v1',
    kind: 'Job',
    metadata: {
      name,
      namespace: o.namespace,
      labels: { app: GEN_LABEL, project: projectKey, skill: job.skill, target: job.targetKey },
      annotations: { 'aialm.ai/queue-id': `${job.skill}#${job.targetKey}` },
    },
    spec: {
      backoffLimit: 0,
      ttlSecondsAfterFinished: 3600,
      template: {
        metadata: { labels: { app: GEN_LABEL, project: projectKey } },
        spec: {
          restartPolicy: 'Never',
          ...(initContainers ? { initContainers } : {}),
          securityContext: { runAsNonRoot: true, runAsUser: 1000, runAsGroup: 1000, fsGroup: 1000, seccompProfile: { type: 'RuntimeDefault' } },
          containers: [
            {
              name: 'gen',
              image: o.image,
              imagePullPolicy: o.imagePullPolicy ?? 'IfNotPresent',
              command: runArgs,
              envFrom: [{ secretRef: { name: o.envSecretName } }],
              volumeMounts: mounts,
              // NOTE: no capabilities-drop and NO allowPrivilegeEscalation
              // here — each of them deterministically crashes opencode/bun
              // inside kind (UnknownError at session start). Isolation stays
              // via runAsNonRoot(1000) + RuntimeDefault seccomp.
              securityContext: { runAsNonRoot: true },
              resources: { requests: { cpu: '150m', memory: '256Mi' }, limits: { memory: '1Gi' } },
            },
          ],
          volumes,
        },
      },
    },
  };
}

export class K8sJobSkillRunner {
  readonly kind = 'k8s' as const;
  private readonly o: K8sRunnerOptions;
  private readonly api: K8sJobApi;

  constructor(opts: K8sRunnerOptions) {
    this.o = opts;
    this.api = opts.api ?? defaultK8sApi();
  }

  /** Create the ephemeral generative Job; returns its externalRef (name). */
  async dispatch(projectKey: string, job: SkillJob): Promise<string> {
    const body = buildGenJob(projectKey, job, this.o);
    await this.api.createJob(this.o.namespace, body);
    return (body.metadata as { name: string }).name;
  }

  /**
   * Reconcile dispatched jobs for a project: terminal Jobs map back onto the
   * queue via the aialm.ai/queue-id annotation. Running queue entries whose
   * external Job no longer exists (deleted or TTL-reaped) are resolved as
   * failed, so they never block re-enqueue. Idempotent per pass.
   */
  async reconcile(projectKey: string): Promise<GenJobOutcome[]> {
    const jobs = await this.api.listJobs(this.o.namespace, `app=${GEN_LABEL},project=${projectKey}`);
    const out: GenJobOutcome[] = [];
    const seen = new Set<string>();
    for (const j of jobs) {
      const name = String((j.metadata as any)?.name ?? '');
      if (name) seen.add(name);
      const status = (j.status ?? {}) as { succeeded?: number; failed?: number; conditions?: Array<Record<string, any>> };
      const id = String((j.metadata as any)?.annotations?.['aialm.ai/queue-id'] ?? '');
      if (!id) continue;
      if (status.succeeded) out.push({ id, outcome: 'done' });
      else if (status.failed) {
        const cond = (status.conditions ?? []).find((c) => c.type === 'Failed');
        out.push({ id, outcome: 'failed', detail: cond?.reason ?? cond?.message ?? 'job failed' });
      }
    }
    for (const qj of listRunningExternal(projectKey)) {
      if (qj.externalRef && !seen.has(qj.externalRef)) {
        out.push({ id: qj.id, outcome: 'failed', detail: `external job vanished: ${qj.externalRef}` });
      }
    }
    return out;
  }
}

function defaultK8sApi(): K8sJobApi {
  const kc = new k8s.KubeConfig();
  kc.loadFromDefault();
  const batch = kc.makeApiClient(k8s.BatchV1Api);
  return {
    async createJob(namespace, job) {
      // v2 client takes a plain object body; cast keeps us decoupled from codegen types.
      return batch.createNamespacedJob({ namespace, body: job as never });
    },
    async listJobs(namespace, labelSelector) {
      const res = await batch.listNamespacedJob({ namespace, labelSelector });
      return (res.items ?? []) as Array<Record<string, any>>;
    },
  };
}

export type SkillRunner = SubprocessSkillRunner | K8sJobSkillRunner;

export function makeSkillRunner(env: NodeJS.ProcessEnv = process.env): SkillRunner {
  if ((env.AIALM_SKILL_RUNNER ?? 'subprocess') === 'k8s') {
    return new K8sJobSkillRunner({
      namespace: env.POD_NAMESPACE || 'default',
      image: env.AIALM_IMAGE || 'ai-alm-oss:local',
      envSecretName: env.AIALM_ENV_SECRET || 'ai-alm-oss-env',
      dataPvcName: env.AIALM_DATA_PVC || 'ai-alm-oss-data',
      sshSecretName: env.AIALM_SSH_SECRET || undefined,
      opencodeAuthSecretName: env.AIALM_OPENCODE_AUTH_SECRET || undefined,
      // Governed default: the workspace's approved model — pods must not guess.
      model: env.AIALM_MODEL || 'opencode-go/ox-alpha-free',
    });
  }
  return new SubprocessSkillRunner();
}

/** One dispatch pass in k8s mode: claim queued jobs and create their Jobs. */
export async function dispatchQueuedK8s(
  runner: K8sJobSkillRunner,
  projectKey: string,
  claimed: Array<{ id: string; skill: string; targetKey: string; repoRef: string }>,
  log: (msg: string) => void = console.log,
): Promise<number> {
  let ok = 0;
  for (const j of claimed) {
    log(`[gen] dispatching ${j.skill} on ${j.targetKey} as K8s Job`);
    try {
      const ref = await runner.dispatch(projectKey, j);
      setExternalRef(projectKey, j.id, ref);
      log(`[gen dispatched] ${j.skill} ${j.targetKey} -> ${ref}`);
      ok++;
    } catch (e) {
      markFailed(projectKey, j.id, (e as Error).message);
      console.error(`[gen dispatch failed] ${j.skill} ${j.targetKey}: ${(e as Error).message}`);
    }
  }
  return ok;
}

/** Apply reconcile outcomes to the queue; returns how many were terminal. */
export function applyOutcomes(
  projectKey: string,
  outcomes: GenJobOutcome[],
  log: (msg: string) => void = console.log,
): number {
  for (const o of outcomes) {
    if (o.outcome === 'done') {
      markDone(projectKey, o.id);
      log(`[gen done] ${o.id}`);
    } else {
      markFailed(projectKey, o.id, o.detail);
      console.error(`[gen failed] ${o.id}: ${o.detail}`);
    }
  }
  return outcomes.length;
}
