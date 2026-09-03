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
 *   - optional opencode auth file / corrected opencode.json (see below)
 *
 * The skill inside does all Jira I/O; host only starts the container.
 * Jira MCP fix: the project's opencode.json has two servers (`jira`=paligakrzychu,
 * `jira-oss`=ai-alm-oss); the `jira` server is for the wrong site for WELLBEINGT
 * (ai-alm-oss) and causes PAT errors when the LLM calls `jira_jira_*` for
 * WELLBEINGT-5. The dispatcher can mount a corrected `opencode.json` where
 * `jira` points to the dispatch target site (JIRA_SITE from .env, currently
 * ai-alm-oss) so `jira_jira_*` is correct. See `correctedOpencodeConfig`.
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
    /** host path to a corrected opencode.json to mount as /app/opencode.json (Jira site fix) */
    hostOpencodeConfigPath?: string;
    /** host path to opencode auth.json to mount for LLM auth (file, not dir) */
    hostOpencodeAuthPath?: string;
    /** host path to opencode local auth dir file (e.g. ~/.local/share/opencode/auth.json) for github-copilot etc. */
    hostOpencodeLocalAuthPath?: string;
    /** model to pass as `opencode run --model <model>` (e.g. opencode/muse-spark-1.2) */
    model?: string;
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
  // Use /proc to avoid requiring `ps` (procps may not be in older built images).
  args.push('--health-cmd', 'cat /proc/*/cmdline 2>/dev/null | tr "\\0" " " | grep -q "opencode" || exit 1');
  args.push('--health-interval', '15s');
  args.push('--health-timeout', '5s');
  args.push('--health-retries', '3');
  args.push('--health-start-period', '10s');

  if (opts.hostCwd) {
    args.push('-v', `${opts.hostCwd}:/app`);
    args.push('-w', '/app');
  }
  if (opts.hostOpencodeConfigDir) {
    // Optional mount for opencode LLM auth (host dir). Disabled by default
    // to avoid overriding the image's project opencode.json MCP jira tokens
    // with stale host-global config (which caused PAT vs API token mismatch).
    // Only mount when explicitly requested (e.g. DISPATCH_MOUNT_OPENCODE=1).
    args.push('-v', `${opts.hostOpencodeConfigDir}:/home/node/.config/opencode:ro`);
  }
  if (opts.hostOpencodeAuthPath) {
    // Mount only the auth file (for LLM), not the whole config dir, so jira MCP stays corrected.
    args.push('-v', `${opts.hostOpencodeAuthPath}:/home/node/.config/opencode/auth.json:ro`);
  }
  if (opts.hostOpencodeLocalAuthPath) {
    // Mount the local share auth.json for github-copilot etc. (provider oauth).
    args.push('-v', `${opts.hostOpencodeLocalAuthPath}:/home/node/.local/share/opencode/auth.json:ro`);
  }
  if (opts.hostOpencodeConfigPath) {
    // Mount corrected opencode.json (single `jira` MCP pointing to dispatch target site).
    args.push('-v', `${opts.hostOpencodeConfigPath}:/app/opencode.json:ro`);
  }
  // Pass Jira/auth env through the container. Prefer --env-file .env if present on host;
  // we still add --env-file arg when hostCwd is set (file is at <hostCwd>/.env).
  if (opts.hostCwd) {
    args.push('--env-file', `${opts.hostCwd}/.env`);
  }

  if (opts.extraArgs?.length) args.push(...opts.extraArgs);

  args.push(image);
  // Skill entrypoint — skill handles all Jira transitions inside.
  if (opts.model) {
    args.push('npx', 'opencode', 'run', '--model', opts.model, skill, job.key);
  } else {
    args.push('npx', 'opencode', 'run', skill, job.key);
  }

  return { args, containerName: name, label: labelFor(job.key) };
}

/** Generate a corrected opencode.json for the dispatch container where `jira` points to the dispatch target site. */
export function correctedOpencodeConfig(jiraSite: string, opts: { jiraEmailEnv?: string; jiraTokenEnv?: string } = {}): string {
  const emailEnv = opts.jiraEmailEnv ?? 'JIRA_EMAIL';
  const tokenEnv = opts.jiraTokenEnv ?? 'JIRA_TOKEN';
  const cfg = {
    $schema: 'https://opencode.ai/config.json',
    permission: { external_directory: { '~/Develop/*': 'allow' } },
    mcp: {
      jira: {
        type: 'local',
        command: ['uvx', 'mcp-atlassian'],
        environment: {
          JIRA_URL: jiraSite,
          JIRA_USERNAME: `{env:${emailEnv}}`,
          JIRA_API_TOKEN: `{env:${tokenEnv}}`,
          // Minimal toolsets to avoid the failing Service Desk / third-party token endpoint.
          // The full MCP default includes jira_service_desk which calls a Jira endpoint
          // that does not support PAT for this Cloud user type (private relay email).
          // Keep only the toolsets needed for po-analyze / generic skills.
          TOOLSETS: 'jira_issues,jira_comments,jira_fields',
        },
        enabled: true,
      },
    },
  };
  // Also try minimal toolsets first; if that fails, the full list is above.
  // For now, keep the corrected config minimal to avoid the third-party token endpoint.
  // The MCP will only load jira_issues and jira_comments by default if TOOLSETS is not set,
  // but we explicitly set it to avoid the failing service desk check.
  return JSON.stringify(cfg, null, 2);
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
