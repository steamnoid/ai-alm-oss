/**
 * aialm-oss-dispatcher — trivial pool (banalny dispatcher).
 *
 * Skill does ALL Jira interaction (IN_PROGRESS_BY_AGENT → AWAITING_HUMAN_APPROVAL
 * per AGENTS.md exclusive mutator). Dispatcher only:
 *   1) scans JQL status="AWAITS AGENT PICKUP" (project) where AIALM AGENT is already set,
 *   2) builds `docker run -d` args for `opencode run <agent> <key>` per ticket,
 *   3) surfaces logs via `docker logs`.
 *
 * No Jira state mutation here. No daemon — one-shot command with optional --watch.
 */
import type { JiraClient } from '../adapter/jira.js';
import type { SelfAwareCids } from '../adapter/fields-config.js';
import { SELF_AWARE_FIELDS } from '../adapter/fields.js';

export interface PickupTicket {
  key: string;
  agent: string;
  stage: string;
  status: string;
}

export interface DispatchJob {
  key: string;
  agent: string;
}

export interface DockerRunSpec {
  /** `docker run` argv (without the leading `docker`). */
  args: string[];
  containerName: string;
  /** label value for filtering (`aialm.dispatch=<key>`). */
  label: string;
}

export const DISPATCH_LABEL = 'aialm.dispatch';
export const DISPATCH_IMAGE_DEFAULT = 'ai-alm-oss:local';

/** JQL for hunting AWAITS AGENT PICKUP tickets in a project. */
export function pickupJql(projectKey: string): string {
  // Quote status value; project key is alphanumeric + underscore, safe to inline.
  return `project = ${projectKey} AND status = "AWAITS AGENT PICKUP" ORDER BY updated ASC`;
}

/** Extract custom-field value shape `{value: string} | string | null`. */
function fieldValue(fields: Record<string, unknown>, cid: string): string | undefined {
  const raw = fields[cid];
  if (raw == null) return undefined;
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  if (typeof raw === 'object' && raw !== null) {
    const v = (raw as { value?: unknown }).value;
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function byNameForTest(fields: Record<string, unknown>, cids: SelfAwareCids): void {
  // kept for parity with orchestrate/byName if needed later
  void SELF_AWARE_FIELDS;
}

/** Scan Jira for pickup tickets (AWAITS AGENT PICKUP) and resolve AGENT per ticket. */
export async function scanPickupTickets(
  jira: JiraClient,
  projectKey: string,
  cids: SelfAwareCids,
  opts: { limit?: number } = {},
): Promise<PickupTicket[]> {
  const jql = pickupJql(projectKey);
  const limit = opts.limit ?? 20;
  const fields: string[] = [cids.stage, cids.agent, 'status'];
  const issues = await jira.searchJql(jql, fields, limit);
  const out: PickupTicket[] = [];
  for (const issue of issues) {
    const key = String((issue as { key?: unknown }).key ?? '');
    if (!key) continue;
    const f = (issue as { fields?: Record<string, unknown> }).fields ?? {};
    const agent = fieldValue(f, cids.agent) ?? 'none';
    const stage = fieldValue(f, cids.stage) ?? 'AWAITING_AGENT_PICKUP';
    const status = (f.status as { name?: string } | undefined)?.name ?? 'AWAITS AGENT PICKUP';
    // Banalny dispatcher only dispatches when AGENT is a real skill (not none).
    if (!agent || agent === 'none') continue;
    out.push({ key, agent, stage, status });
  }
  return out;
}

/** Map AGENT field value to skill name — 1:1 in this repo (e.g. `aialm-oss-po-analyze`). */
export function agentToSkill(agent: string): string {
  return agent.trim();
}

/** Validate that agent is a known aialm-oss skill (prefix check). */
export function isDispatchableAgent(agent: string): boolean {
  return agent.startsWith('aialm-oss-') && agent !== 'none';
}

/** Build a stable-ish container name; suffix avoids collisions for re-dispatch. */
export function containerNameFor(projectKey: string, key: string, suffix?: string): string {
  const slug = `${projectKey}-${key}`.toLowerCase().replace(/[^a-z0-9-]+/g, '-');
  const ent = suffix ?? Date.now().toString(36).slice(-6);
  return `aialm-${slug}-${ent}`;
}

/** Label value for this ticket. */
export function labelFor(key: string): string {
  return key;
}

/**
 * Build `docker run -d` argv for one dispatched skill.
 *
 * Host mounts:
 *   - `$(pwd)` → `/app` (repo + .work + scripts)
 *   - `$(pwd)/.env` via `--env-file` (JIRA + tokens) — mount, not baked
 *   - `~/.config/opencode` → `/home/node/.config/opencode:ro` (opencode auth, if present)
 *
 * The skill inside does all Jira I/O; host only starts the container.
 */
export function buildDockerRunSpec(
  job: DispatchJob,
  opts: {
    projectKey: string;
    image?: string;
    /** host cwd to mount at /app (default: process.cwd() caller supplies) */
    hostCwd?: string;
    /** host path to opencode config dir (default: ~/.config/opencode) */
    hostOpencodeConfigDir?: string;
    /** extra suffix for container name (test seam) */
    nameSuffix?: string;
    /** extra docker args (test seam) */
    extraArgs?: string[];
  },
): DockerRunSpec {
  const image = opts.image ?? DISPATCH_IMAGE_DEFAULT;
  const name = containerNameFor(opts.projectKey, job.key, opts.nameSuffix);
  const skill = agentToSkill(job.agent);
  const args: string[] = [
    'run',
    '-d',
    '--name',
    name,
    '--label',
    `${DISPATCH_LABEL}=${labelFor(job.key)}`,
    '--label',
    `aialm.project=${opts.projectKey}`,
    '--label',
    `aialm.skill=${skill}`,
  ];

  // Deterministic HEALTHCHECK — trivial liveness of the opencode process.
  // Jira status reconcile is owned by the skill, so health is only for
  // container monitoring (docker inspect --format '{{.State.Health.Status}}').
  args.push('--health-cmd', 'ps aux | grep -q "[o]pencode" || exit 1');
  args.push('--health-interval', '15s');
  args.push('--health-timeout', '5s');
  args.push('--health-retries', '3');
  args.push('--health-start-period', '10s');

  if (opts.hostCwd) {
    args.push('-v', `${opts.hostCwd}:/app`);
    args.push('-w', '/app');
  }
  if (opts.hostOpencodeConfigDir) {
    // Mount opencode auth/config for the in-container `opencode run` LLM/Jira access.
    // Best-effort: host dir may not exist — Docker will create an empty dir, harmless.
    args.push('-v', `${opts.hostOpencodeConfigDir}:/home/node/.config/opencode:ro`);
  }
  // Pass Jira/auth env through the container. Prefer --env-file .env if present on host;
  // we still add --env-file arg when hostCwd is set (file is at <hostCwd>/.env).
  if (opts.hostCwd) {
    args.push('--env-file', `${opts.hostCwd}/.env`);
  }

  if (opts.extraArgs?.length) args.push(...opts.extraArgs);

  args.push(image);
  // Skill entrypoint — skill handles all Jira transitions inside.
  args.push('npx', 'opencode', 'run', skill, job.key);

  return { args, containerName: name, label: labelFor(job.key) };
}

/** CLI helper: parse `docker ps -a` / `docker inspect` lines into status rows. */
export interface ContainerStatus {
  id: string;
  name: string;
  key: string; // from label aialm.dispatch
  state: string; // docker State.Status (running/exited/...)
  health: string | undefined; // State.Health.Status (healthy/unhealthy/starting/none)
  exitCode: number | undefined;
}

export function parseInspectJson(raw: string): ContainerStatus | null {
  try {
    const arr = JSON.parse(raw) as Array<Record<string, unknown>>;
    const c = arr[0];
    if (!c) return null;
    const id = String((c.Id as string) ?? '').slice(0, 12);
    const name = String((c.Name as string) ?? '').replace(/^\//, '');
    const state = (c.State as { Status?: string; ExitCode?: number; Health?: { Status?: string } } | undefined);
    const labels = (c.Config as { Labels?: Record<string, string> } | undefined)?.Labels ?? {};
    const key = labels[DISPATCH_LABEL] ?? '';
    return {
      id,
      name,
      key,
      state: String(state?.Status ?? 'unknown'),
      health: state?.Health?.Status ? String(state.Health.Status) : undefined,
      exitCode: typeof state?.ExitCode === 'number' ? state.ExitCode : undefined,
    };
  } catch {
    return null;
  }
}
