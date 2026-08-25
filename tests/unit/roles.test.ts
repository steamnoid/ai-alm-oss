import { describe, expect, it, vi } from 'vitest';
import {
  assignRoleApprover,
  deriveProjectKey,
  ensureGovernanceTicket,
  readRoles,
} from '../../src/aialm/oss/governance/roles.ts';
import { codeBlock, doc, para } from '../../src/aialm/oss/alm/adf.ts';
import type { JiraClient } from '../../src/aialm/oss/alm/jira.ts';

function rolesAdf(po: string, qa: string, dev: string) {
  return doc(para({ t: '## Roles', b: true }), codeBlock(`po: ${po}\nqa: ${qa}\ndev: ${dev}`));
}

function govAdf(roles: { po: string; qa: string; dev: string; sec: string; arch: string }, flags: { sec: boolean; arch: boolean }) {
  return doc(
    para({ t: '## Roles', b: true }),
    codeBlock(`po: ${roles.po}\nqa: ${roles.qa}\ndev: ${roles.dev}\nsec: ${roles.sec}\narch: ${roles.arch}\n`),
    para({ t: '## Flags', b: true }),
    codeBlock(`sec: ${flags.sec ? 'on' : 'off'}\narch: ${flags.arch ? 'on' : 'off'}\n`),
    para('Edit these lines to split responsibilities; opts default to on and default to the project lead.'),
  );
}

function mockJira(opts: { governance?: { key: string; adf: unknown }; lead?: string } = {}) {
  const assignCalls: { key: string; accountId: string }[] = [];
  const created: any[] = [];
  return {
    jira: {
      searchJql: vi.fn(async (jql: string) => {
        if (/labels = governance/.test(jql)) return opts.governance ? [{ key: opts.governance.key }] : [];
        return [];
      }),
      getIssue: vi.fn(async () => ({ fields: { description: opts.governance?.adf ?? doc(para('')) } })),
      getProject: vi.fn(async () => ({ lead: { accountId: opts.lead ?? 'LEAD1' } })),
      taskTypeId: vi.fn(async () => '10008'),
      createIssue: vi.fn(async (fields: Record<string, unknown>) => { created.push(fields); return { key: 'WELLBEINGT-9' }; }),
      assign: vi.fn(async (key: string, accountId: string) => { assignCalls.push({ key, accountId }); }),
    } as unknown as JiraClient,
    assignCalls,
    created,
  };
}

describe('deriveProjectKey', () => {
  it('splits the prefix before the sequence number', () => {
    expect(deriveProjectKey('WELLBEINGT-2')).toBe('WELLBEINGT');
    expect(deriveProjectKey('AIALMOSS-35')).toBe('AIALMOSS');
  });
});

describe('readRoles', () => {
  it('parses roles from the governance ticket', async () => {
    const { jira } = mockJira({ governance: { key: 'WELLBEINGT-9', adf: rolesAdf('PO1', 'QA1', 'DEV1') } });
    expect(await readRoles(jira, 'WELLBEINGT')).toEqual({ po: 'PO1', qa: 'QA1', dev: 'DEV1' });
  });

  it('falls back to the project lead when no governance ticket exists', async () => {
    const { jira } = mockJira({ lead: 'LEAD9' });
    expect(await readRoles(jira, 'WELLBEINGT')).toEqual({ po: 'LEAD9', qa: 'LEAD9', dev: 'LEAD9', sec: 'LEAD9', arch: 'LEAD9' });
  });
});

describe('ensureGovernanceTicket', () => {
  it('creates once and reuses on re-run', async () => {
    const { jira, created } = mockJira({ lead: 'LEAD1' });
    const k1 = await ensureGovernanceTicket(jira, { projectKey: 'WELLBEINGT', leadAccountId: 'LEAD1' });
    expect(k1).toBe('WELLBEINGT-9');
    expect(created).toHaveLength(1);
    expect(created[0]!.labels).toContain('governance');
    // second call with an existing ticket → reuse
    const gov = { governance: { key: 'WELLBEINGT-9', adf: rolesAdf('L', 'L', 'L') } };
    const { jira: j2 } = mockJira(gov);
    expect(await ensureGovernanceTicket(j2, { projectKey: 'WELLBEINGT', leadAccountId: 'L' })).toBe('WELLBEINGT-9');
  });
});

describe('assignRoleApprover', () => {
  it('assigns the role owner and reports assigned', async () => {
    const { jira, assignCalls } = mockJira({ governance: { key: 'WELLBEINGT-9', adf: rolesAdf('PO1', 'QA1', 'DEV1') } });
    const r = await assignRoleApprover(jira, 'WELLBEINGT-2', 'po');
    expect(r.assigned).toBe(true);
    expect(assignCalls).toEqual([{ key: 'WELLBEINGT-2', accountId: 'PO1' }]);
  });

  it('does nothing when the role is unset', async () => {
    const { jira, assignCalls } = mockJira({ governance: { key: 'WELLBEINGT-9', adf: doc(para('no roles')) } });
    const r = await assignRoleApprover(jira, 'WELLBEINGT-2', 'dev');
    expect(r.assigned).toBe(false);
    expect(assignCalls).toHaveLength(0);
  });

  it('assigns SEC when the sec flag is on', async () => {
    const { jira, assignCalls } = mockJira({ governance: { key: 'WELLBEINGT-9', adf: govAdf({ po: 'L', qa: 'L', dev: 'L', sec: 'SEC1', arch: 'A1' }, { sec: true, arch: true }) } });
    const r = await assignRoleApprover(jira, 'WELLBEINGT-2', 'sec');
    expect(r.assigned).toBe(true);
    expect(r.downgradedToDev).toBe(false);
    expect(assignCalls).toEqual([{ key: 'WELLBEINGT-2', accountId: 'SEC1' }]);
  });

  it('falls back to DEV with downgrade flag when sec is off', async () => {
    const { jira, assignCalls } = mockJira({ governance: { key: 'WELLBEINGT-9', adf: govAdf({ po: 'L', qa: 'L', dev: 'DEVC', sec: 'SEC1', arch: 'A1' }, { sec: false, arch: true }) } });
    const r = await assignRoleApprover(jira, 'WELLBEINGT-2', 'sec');
    expect(r.assigned).toBe(true);
    expect(r.downgradedToDev).toBe(true);
    expect(assignCalls).toEqual([{ key: 'WELLBEINGT-2', accountId: 'DEVC' }]);
  });
});
