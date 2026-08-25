import { exec as nodeExec } from 'node:child_process';
import { type AdfNode, bullets, doc, para } from '../alm/adf.ts';
import { proposalIdFor } from '../shared/identity.ts';
import type { EvidenceEntry, EvidenceResult } from '../shared/models.ts';
import { titleFromScenario } from '../qa/impl.ts';

export type ScenarioOutcome = 'pass' | 'fail' | 'error';
export type ScenarioKind = 'CORE' | 'EDGE' | 'CREATIVE';

export interface ScenarioResult {
  scenarioId: string;
  testTitle: string;
  kind: ScenarioKind;
  outcome: ScenarioOutcome;
}

export type ChildStatus = 'PASS' | 'PARTIAL' | 'FAILED' | 'BLOCKED';

export interface ChildClass {
  status: ChildStatus;
  reason?: string;
}

export interface VerificationVerdict {
  ready: boolean;
  reason: string;
}

const GENERATED_QA_START = 'GENERATED QA hash:';
const GENERATED_QA_END = 'END GENERATED QA';

function nodeText(node: unknown): string {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(nodeText).join('');
  const n = node as { text?: unknown; content?: unknown[] };
  let out = typeof n.text === 'string' ? n.text : '';
  if (Array.isArray(n.content)) out += n.content.map(nodeText).join('');
  return out;
}

function asContent(description: unknown): unknown[] {
  const c = (description as { content?: unknown[] })?.content;
  return Array.isArray(c) ? c : [];
}

/** Deterministic GENERATED scenario id (traceability key). */
export function scenarioIdFor(scenario: string): string {
  return proposalIdFor(`GENERATED QA\n${scenario}`);
}

/** Extract GENERATED scenarios paired with their `# kind:` metadata. */
export function extractGeneratedScenarios(description: unknown): { scenario: string; kind: ScenarioKind }[] {
  const out: { scenario: string; kind: ScenarioKind }[] = [];
  let inBlock = false;
  let kind: ScenarioKind = 'CORE';
  for (const node of asContent(description)) {
    const t = nodeText(node);
    if (t.includes(GENERATED_QA_START)) { inBlock = true; continue; }
    if (t.includes(GENERATED_QA_END)) { inBlock = false; continue; }
    if (!inBlock) continue;
    const kindMatch = /# kind:\s*(CORE|EDGE|CREATIVE)/.exec(t);
    if (kindMatch) { kind = kindMatch[1] as ScenarioKind; continue; }
    if ((node as { type?: string }).type === 'codeBlock') {
      const s = nodeText(node).trim();
      if (s) out.push({ scenario: s, kind });
    }
  }
  return out;
}

/** Build a ScenarioResult for a tested scenario. */
export function scenarioResult(scenario: string, outcome: ScenarioOutcome, kind: ScenarioKind = 'CORE'): ScenarioResult {
  return { scenarioId: scenarioIdFor(scenario), testTitle: `QA: ${titleFromScenario(scenario)}`, kind, outcome };
}

/**
 * Capture integrity: turn an executed command into a machine-checkable
 * EvidenceEntry. `errored` = command truly failed to run (environment/missing).
 * result = pass | fail | error; never omits output.
 */
export function makeEvidence(input: { command: string; exitCode: number; artifactRef?: string; errored?: boolean; now?: string }): EvidenceEntry {
  const result: EvidenceResult = input.errored ? 'error' : input.exitCode === 0 ? 'pass' : 'fail';
  return {
    stage: 'verify',
    command: input.command,
    artifactRef: input.artifactRef,
    result,
    timestamp: input.now ?? new Date().toISOString(),
  };
}

/**
 * Classify a child wave: BLOCKED (no evidence / command error),
 * FAILED (any failed command or failed/errored scenario), PASS (all green),
 * PARTIAL (completed but with gaps). Never pretends success without evidence.
 */
export function classifyChild(evidence: EvidenceEntry[], scenarios: ScenarioResult[]): ChildClass {
  if (!evidence.length) return { status: 'BLOCKED', reason: 'no validation commands executed' };
  const errored = evidence.find(e => e.result === 'error');
  if (errored) return { status: 'BLOCKED', reason: `command error: ${errored.command}` };
  const failedEv = evidence.find(e => e.result === 'fail');
  const failedSc = scenarios.find(s => s.outcome === 'fail' || s.outcome === 'error');
  if (failedEv) return { status: 'FAILED', reason: `command failed: ${failedEv.command}` };
  if (failedSc) return { status: 'FAILED', reason: `scenario failed: ${failedSc.scenarioId}` };
  if (scenarios.length && scenarios.every(s => s.outcome === 'pass') && evidence.every(e => e.result === 'pass')) return { status: 'PASS' };
  return { status: 'PARTIAL', reason: 'partial coverage' };
}

/** PR readiness: READY_FOR_PR only when ALL CORE scenarios are green. */
export function prReadiness(scenarios: ScenarioResult[]): VerificationVerdict {
  const core = scenarios.filter(s => s.kind === 'CORE');
  if (!core.length) return { ready: false, reason: 'no CORE scenarios to prove PR readiness' };
  const notGreen = core.filter(s => s.outcome !== 'pass');
  if (notGreen.length) return { ready: false, reason: `core scenarios not green: ${notGreen.map(s => s.scenarioId).join(', ')}` };
  return { ready: true, reason: 'all CORE scenarios green' };
}

/** Append-only evidence summary comment on the parent. */
export function verifySummaryComment(rows: { target: string; status: ChildStatus; detail?: string }[], verdict: VerificationVerdict): AdfNode {
  return doc(
    para({ t: '[AI-generated] Verification evidence summary', b: true }),
    bullets(rows.map(r => [{ t: `${r.status}`, c: true }, ` ${r.target}`, ...(r.detail ? [` — ${r.detail}`] : [])])),
    para({ t: `PR readiness: ${verdict.ready ? 'READY_FOR_PR' : 'NOT_READY'}`, c: true }),
    para(verdict.reason),
  );
}

export interface CommandResult {
  exitCode: number;
  output: string;
  errored: boolean;
}

export type CommandRunner = (command: string, cwd?: string) => Promise<CommandResult>;

const defaultRunner: CommandRunner = (command, cwd) =>
  new Promise((resolve) => {
    nodeExec(command, { cwd, timeout: 600_000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = typeof (err as NodeJS.ErrnoException | null)?.code === 'number' ? ((err as any).code as number) : err ? 1 : 0;
      resolve({ exitCode: code, output: `${stdout ?? ''}\n${stderr ?? ''}`.trim(), errored: false });
    });
  });

/**
 * Execute `Profile.ciCommands` in order, capturing exit codes + output into
 * EvidenceEntry[] (result pass|fail|error; never omits command output). No
 * "success" is claimed without real command execution and evidence.
 */
export async function runValidation(
  commands: string[],
  opts: { cwd?: string; runner?: CommandRunner; now?: () => string } = {},
): Promise<EvidenceEntry[]> {
  const runner = opts.runner ?? defaultRunner;
  const now = opts.now ?? (() => new Date().toISOString());
  const out: EvidenceEntry[] = [];
  for (const command of commands) {
    try {
      const r = await runner(command, opts.cwd);
      const result: EvidenceResult = r.errored ? 'error' : r.exitCode === 0 ? 'pass' : 'fail';
      out.push({ stage: 'verify', command, artifactRef: r.output.slice(0, 2000) || '(no output)', result, timestamp: now() });
    } catch (e) {
      out.push({ stage: 'verify', command, artifactRef: String(e).slice(0, 2000), result: 'error', timestamp: now() });
    }
  }
  return out;
}
