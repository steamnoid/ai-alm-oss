/**
 * aialm-oss-adapter — provisioning of the self-aware custom fields (per-klient).
 *
 * AGENTS.md → Wdrożenie: każdy kliencki projekt dostaje pola select
 * `AIALM STAGE`, `AIALM ROLE`, `AIALM AGENT` z wartościami wg canonicalnego
 * modelu (STAGES/ROLES/AGENTS z shared/state.ts). Ten moduł:
 *  - wykrywa czy pola już istnieją (idempotencja po nazwie),
 *  - tworzy brakujące + dodaje opcje do default context,
 *  - zwraca mapę `{stage, role, agent} → customfield_NNNNN` używaną przy write.
 */
import { AGENTS, ROLES, STAGES } from '../shared/state.js';
import { SELF_AWARE_FIELDS } from './fields.js';
import type { JiraClient, CustomFieldInfo } from './jira.js';

const SELECT_TYPE = 'com.atlassian.jira.plugin.system.customfieldtypes:select';
const SELECT_SEARCHER = 'com.atlassian.jira.plugin.system.customfieldtypes:multiselectsearcher';

/** Canonicalne wartości opcji dla każdego z pól self-aware. */
export const SELF_AWARE_OPTIONS: Record<keyof typeof SELF_AWARE_FIELDS, readonly string[]> = {
  stage: STAGES,
  role: ROLES,
  agent: AGENTS,
};

export interface SelfAwareCids {
  stage: string;
  role: string;
  agent: string;
}

export interface FieldDef {
  name: string;
  options: readonly string[];
}

export function fieldDefinitions(): FieldDef[] {
  return (Object.keys(SELF_AWARE_FIELDS) as Array<keyof typeof SELF_AWARE_FIELDS>).map(k => ({
    name: SELF_AWARE_FIELDS[k],
    options: SELF_AWARE_OPTIONS[k],
  }));
}

function findByName(fields: CustomFieldInfo[], name: string): CustomFieldInfo | undefined {
  return fields.find(f => f.name.toLowerCase() === name.toLowerCase());
}

/**
 * Ensure the 3 self-aware fields exist with canonical options, and return the
 * CID map. Idempotent: existing fields (matched by name) are reused; only
 * missing canonical options are appended.
 */
/**
 * Ensure the 3 self-aware fields exist with canonical options, wired onto the
 * given (company-managed) project's own screens, and return the CID map.
 *
 * Idempotent: existing fields (matched by name) are reused; missing canonical
 * options are appended; fields are placed on each project screen's field tab,
 * so they become settable via the API for that project's issue types.
 */
export async function ensureSelfAwareFields(
  jira: JiraClient,
  projectKey: string,
): Promise<SelfAwareCids> {
  const existing = await jira.listAllFields();
  const defs = fieldDefinitions();

  // Screens belonging to this project are named `<KEY>: <…>` in company-managed
  // projects. Wire each self-aware field onto every one of those screens.
  const screens = (await jira.listScreens()).filter(s =>
    s.name.toUpperCase().startsWith(`${projectKey.toUpperCase()}:`),
  );
  const tabs = new Map<string, string>();
  for (const screen of screens) {
    try {
      tabs.set(screen.id, await jira.screenFirstTabId(screen.id));
    } catch {
      // Non-addressable (e.g. zombie) screen — skip quietly.
    }
  }

  const cids: Partial<SelfAwareCids> = {};
  for (const def of defs) {
    let field = findByName(existing, def.name);
    if (!field) {
      field = await jira.createCustomField({
        name: def.name,
        description: 'AI ALM OSS self-aware field (AGENTS.md).',
        type: SELECT_TYPE,
        searcherKey: SELECT_SEARCHER,
      });
    }
    await ensureOptions(jira, field, def.options);
    for (const [screenId, tabId] of tabs) {
      try {
        await jira.addFieldToScreenTab(field.id, screenId, tabId);
      } catch {
        // Field already on tab or screen no longer manageable — ignore.
      }
    }
    cids[defToKey(def.name)] = field.id;
  }

  const result = cids as SelfAwareCids;
  if (!result.stage || !result.role || !result.agent) {
    throw new Error('failed to provision self-aware custom fields');
  }
  return result;
}

async function ensureOptions(jira: JiraClient, field: CustomFieldInfo, options: readonly string[]): Promise<void> {
  const contextId = await jira.customFieldDefaultContextId(field.id);
  const existing = await jira.listFieldOptions(field.id, contextId);
  const have = new Set(existing.map(o => o.value));
  const missing = options.filter(o => !have.has(o));
  // Jira rejects duplicate option values (400), so only add what isn't present.
  if (missing.length > 0) {
    await jira.addFieldOptions(field.id, contextId, missing);
  }
}

function defToKey(name: string): 'stage' | 'role' | 'agent' {
  if (name === SELF_AWARE_FIELDS.stage) return 'stage';
  if (name === SELF_AWARE_FIELDS.role) return 'role';
  return 'agent';
}