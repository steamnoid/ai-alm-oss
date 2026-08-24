import { type AdfNode, doc, para } from '../alm/adf.ts';
import type { DevProposalKind } from '../dev/analyst.ts';

export type ImplStatus = 'IMPLEMENTED' | 'IMPLEMENTED_WITH_FAILURES' | 'BLOCKED';

export interface ContractHooks {
  hasContract: boolean;
  hooks: string[]; // stable selectors/identifiers (e.g. data-testid values)
  kinds: DevProposalKind[];
}

export interface TestPlanItem {
  scenario: string;
  scenarioName: string;
  title: string; // `QA: <scenarioName>` traceability marker
  path: string; // Profile-convention test path
  hook?: string; // bound selector/seam from the frozen contract
  hasHook: boolean;
  status: 'PLANNED' | 'BLOCKED';
  reason?: string;
}

export interface QaImplPlan {
  tests: TestPlanItem[];
  status: ImplStatus;
  blockedReasons: string[];
}

const GENERATED_QA_START = 'GENERATED QA hash:';
const GENERATED_QA_END = 'END GENERATED QA';
const DEV_HASH = 'GENERATED DEV hash:';
const DEV_END = 'END GENERATED DEV';

const UI_KINDS: ReadonlySet<DevProposalKind> = new Set(['SEAM', 'LOCATOR', 'UI-STATE', 'API']);

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

/** Gherkin scenario title: text after `Scenario:` (first line). */
export function titleFromScenario(scenario: string): string {
  const m = /^Scenario:\s*([^\n]+)/.exec(scenario.trim());
  return (m ? m[1]!.trim() : scenario.trim().slice(0, 60)).slice(0, 120) || 'untitled';
}

/** Deterministic test path under `tests/qa/` (Profile conventions may override). */
export function testPathFor(scenarioName: string): string {
  const slug = scenarioName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'scenario';
  return `tests/qa/${slug}.test.ts`;
}

/** Extract GENERATED QA scenarios from a target description. */
export function extractGeneratedQa(description: unknown): string[] {
  const out: string[] = [];
  let inBlock = false;
  for (const node of asContent(description)) {
    const t = nodeText(node);
    if (t.includes(GENERATED_QA_START)) { inBlock = true; continue; }
    if (t.includes(GENERATED_QA_END)) { inBlock = false; continue; }
    if (inBlock && (node as { type?: string }).type === 'codeBlock') {
      const s = nodeText(node).trim();
      if (s) out.push(s);
    }
  }
  return out;
}

/** Extract approved Implementation Contract hooks/kinds from a target description. */
export function extractContract(description: unknown): ContractHooks {
  let found = false;
  let inBlock = false;
  const hooks = new Set<string>();
  const kinds = new Set<DevProposalKind>();
  for (const node of asContent(description)) {
    const t = nodeText(node);
    if (t.includes(DEV_HASH)) { found = true; inBlock = true; continue; }
    if (t.includes(DEV_END)) { inBlock = false; continue; }
    if (!inBlock) continue;
    const kindMatch = /# kind:\s*([A-Z-]+)/.exec(t);
    if (kindMatch) kinds.add(kindMatch[1] as DevProposalKind);
    for (const m of t.matchAll(/data-(?:testid|test-id)="([^"]+)"/g)) hooks.add(m[1] as string);
  }
  return { hasContract: found && (hooks.size > 0 || kinds.size > 0), hooks: [...hooks], kinds: [...kinds] };
}

function contractNeedsUi(contract: ContractHooks): boolean {
  return contract.kinds.some(k => UI_KINDS.has(k));
}

/**
 * Plan scenario → executable test mapping from the frozen contract.
 * - Empty GENERATED QA → BLOCKED for the target.
 * - UI automation required but no approved hooks → BLOCKED per scenario (never
 *   invent hooks); run dev-analyst + dev-update-approved first.
 * - Otherwise bind exactly the contract hook and mark the test `QA: <name>`.
 */
export function planTests(input: { generatedQa: string[]; contract: ContractHooks }): QaImplPlan {
  const { generatedQa, contract } = input;
  const blockedReasons: string[] = [];

  if (!generatedQa.length) {
    return { tests: [], status: 'BLOCKED', blockedReasons: ['no GENERATED QA'] };
  }

  const uiRequired = contractNeedsUi(contract);
  const tests: TestPlanItem[] = generatedQa.map((scenario, i) => {
    const scenarioName = titleFromScenario(scenario);
    const path = testPathFor(scenarioName);
    let hook: string | undefined;
    let status: 'PLANNED' | 'BLOCKED' = 'PLANNED';
    let reason: string | undefined;

    if (!contract.hasContract) {
      status = 'BLOCKED';
      reason = 'requires an approved Implementation Contract (run aialm-oss-dev-analyst then aialm-oss-dev-update-approved)';
      blockedReasons.push(reason);
    } else if (uiRequired) {
      hook = contract.hooks[Math.min(i, contract.hooks.length - 1)];
      if (!hook) {
        status = 'BLOCKED';
        reason = 'UI automation required but no approved hook in the contract';
        blockedReasons.push(reason);
      }
    } else if (contract.hooks.length) {
      hook = contract.hooks[Math.min(i, contract.hooks.length - 1)];
    }

    return {
      scenario,
      scenarioName,
      title: `QA: ${scenarioName}`,
      path,
      hook,
      hasHook: Boolean(hook),
      status,
      reason,
    };
  });

  const blocked = tests.filter(t => t.status === 'BLOCKED').length;
  const status: ImplStatus = !tests.length || blocked === tests.length ? 'BLOCKED' : blocked ? 'IMPLEMENTED_WITH_FAILURES' : 'IMPLEMENTED';
  return { tests, status, blockedReasons };
}

/** Honest classification from a per-target run outcome. */
export function classifyPlan(items: TestPlanItem[]): ImplStatus {
  const blocked = items.filter(i => i.status === 'BLOCKED').length;
  if (!items.length) return 'BLOCKED';
  if (blocked === items.length) return 'BLOCKED';
  return blocked ? 'IMPLEMENTED_WITH_FAILURES' : 'IMPLEMENTED';
}

/** Marker footer for a mapped test (traceability / idempotency detection). */
export function testMarker(scenarioName: string): string {
  return `QA: ${scenarioName}`;
}

export function planSummary(status: ImplStatus, counts: { planned: number; blocked: number }): AdfNode {
  return doc(
    para({ t: '[AI-generated] QA implementation summary', b: true }),
    para({ t: `status: ${status}`, c: true }),
    para({ t: `Planned: ${counts.planned}`, c: true }),
    para({ t: `Blocked: ${counts.blocked}`, c: true }),
  );
}
