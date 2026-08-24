import { type AdfNode, doc, para } from '../alm/adf.ts';
import { acRef, extractAc } from '../po/work-itemize.ts';

export type ImplStatus = 'IMPLEMENTED' | 'IMPLEMENTED_WITH_FAILURES' | 'BLOCKED';

const GENERATED_QA_START = 'GENERATED QA hash:';
const GENERATED_QA_END = 'END GENERATED QA';
const DEV_HASH = 'GENERATED DEV hash:';
const DEV_END = 'END GENERATED DEV';

export interface DevContractHooks {
  hasContract: boolean;
  hooks: string[]; // stable selectors (data-testid values)
  kinds: string[];
}

export interface ImplTargetInputs {
  acs: string[];
  hasAc: boolean;
  hasGeneratedQa: boolean;
  contract: DevContractHooks;
}

export interface ImplPlanItem {
  kind: 'HOOK' | 'AC';
  key: string; // hook value or acRef
  hook?: string;
  status: 'PLANNED' | 'BLOCKED';
  reason?: string;
}

export interface DevImplPlan {
  slices: ImplPlanItem[];
  status: ImplStatus;
  blockedReasons: string[];
}

const UI_KINDS = new Set(['SEAM', 'LOCATOR', 'UI-STATE', 'API']);

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

function extractGeneratedQa(description: unknown): string[] {
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

function extractContract(description: unknown): DevContractHooks {
  let found = false;
  let inBlock = false;
  const hooks = new Set<string>();
  const kinds = new Set<string>();
  for (const node of asContent(description)) {
    const t = nodeText(node);
    if (t.includes(DEV_HASH)) { found = true; inBlock = true; continue; }
    if (t.includes(DEV_END)) { inBlock = false; continue; }
    if (!inBlock) continue;
    const kindMatch = /# kind:\s*([A-Z-]+)/.exec(t);
    if (kindMatch) kinds.add(kindMatch[1] as string);
    for (const m of t.matchAll(/data-(?:testid|test-id)="([^"]+)"/g)) hooks.add(m[1] as string);
  }
  return { hasContract: found && (hooks.size > 0 || kinds.size > 0), hooks: [...hooks], kinds: [...kinds] };
}

/** Read the frozen inputs of a processed target from its description. */
export function implTargetInputs(description: unknown): ImplTargetInputs {
  const acs = extractAc(description);
  return {
    acs,
    hasAc: acs.length > 0,
    hasGeneratedQa: extractGeneratedQa(description).length > 0,
    contract: extractContract(description),
  };
}

/**
 * Plan an implementation for a target under the frozen contract.
 * - Requires approved Product AC, non-empty GENERATED QA (intent alignment) and
 *   a non-empty Implementation Contract; missing → BLOCKED for the target.
 * - UI in scope → require approved hooks; never invent hooks.
 * - Slices = one HOOK per approved hook (wire exactly) + one AC slice per AC.
 */
export function planImpl(input: ImplTargetInputs): DevImplPlan {
  const { acs, hasAc, hasGeneratedQa, contract } = input;
  const blockedReasons: string[] = [];

  if (!hasAc) return { slices: [], status: 'BLOCKED', blockedReasons: ['no approved Product AC'] };
  if (!hasGeneratedQa) return { slices: [], status: 'BLOCKED', blockedReasons: ['no GENERATED QA (intent alignment)'] };
  if (!contract.hasContract) return { slices: [], status: 'BLOCKED', blockedReasons: ['missing Implementation Contract (run dev-analyst then dev-update-approved)'] };

  const uiRequired = contract.kinds.some(k => UI_KINDS.has(k));
  if (uiRequired && contract.hooks.length === 0) {
    return { slices: [], status: 'BLOCKED', blockedReasons: ['UI in scope but no approved hooks in the contract'] };
  }

  const slices: ImplPlanItem[] = [];
  for (const hook of contract.hooks) {
    slices.push({ kind: 'HOOK', key: hook, hook, status: 'PLANNED' });
  }
  for (const ac of acs) {
    slices.push({ kind: 'AC', key: acRef(ac), status: 'PLANNED' });
  }
  if (!slices.length) return { slices: [], status: 'BLOCKED', blockedReasons: ['nothing to implement'] };

  return { slices, status: 'IMPLEMENTED', blockedReasons };
}

/** Honest classification. */
export function classifyImpl(items: ImplPlanItem[]): ImplStatus {
  const blocked = items.filter(i => i.status === 'BLOCKED').length;
  if (!items.length) return 'BLOCKED';
  if (blocked === items.length) return 'BLOCKED';
  return blocked ? 'IMPLEMENTED_WITH_FAILURES' : 'IMPLEMENTED';
}

export function implSummary(status: ImplStatus, counts: { hooks: number; acs: number }): AdfNode {
  return doc(
    para({ t: '[AI-generated] Feature implementation summary', b: true }),
    para({ t: `status: ${status}`, c: true }),
    para({ t: `Hooks: ${counts.hooks}`, c: true }),
    para({ t: `AC: ${counts.acs}`, c: true }),
  );
}
