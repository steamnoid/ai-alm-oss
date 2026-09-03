import { describe, it, expect } from 'vitest';
import { deriveProjectKey, projectKeyCandidates, projectDisplayName } from '../../src/aialm/oss/onboard/key.js';
import { parseGovernance, renderGovernance } from '../../src/aialm/oss/onboard/governance.js';
import { renderProfileMarkdown } from '../../src/aialm/oss/onboard/onboard.js';
import type { ProjectAiProfile } from '../../src/aialm/oss/onboard/profile.js';

describe('project key derivation', () => {
  it('normalizes to uppercase alnum, max 10', () => {
    expect(deriveProjectKey('my.cool_repo')).toBe('MYCOOLREPO');
    expect(deriveProjectKey('a-very-long-repository-name-here')).toBe('AVERYLONGR');
  });

  it('throws on empty', () => {
    expect(() => deriveProjectKey('!!!')).toThrow(/Cannot derive/);
  });

  it('candidates are BASE, BASE2..BASE9', () => {
    const c = projectKeyCandidates('repo');
    expect(c[0]).toBe('REPO');
    expect(c).toContain('REPO2');
    expect(c).toHaveLength(10);
  });

  it('display name uses [AI-ALM] owner/repo', () => {
    expect(projectDisplayName('acme', 'lib')).toBe('[AI-ALM] acme/lib');
  });
});

describe('governance parse/render', () => {
  it('parses roles and flags from rendered output', () => {
    const md = renderGovernance(
      { po: 'lead-1', qa: 'lead-1', dev: 'lead-1', sec: 'sec-9', ai: 'lead-1' },
      { sec: false, arch: true },
      'lead-1',
    );
    const parsed = parseGovernance(md);
    expect(parsed.roles).toMatchObject({ po: 'lead-1', dev: 'lead-1', sec: 'sec-9', ai: 'lead-1' });
    expect(parsed.flags).toEqual({ sec: false, arch: true });
  });

  it('parses ai role and round-trips', () => {
    const md = renderGovernance({ po: 'a', qa: 'a', dev: 'a', ai: 'ai-9' }, { sec: true, arch: true }, 'a');
    expect(parseGovernance(md).roles.ai).toBe('ai-9');
    expect(md).toContain('ai: ai-9');
  });

  it('sec/arch default on when absent', () => {
    const md = ['## Flags', '```', 'sec: on', 'arch: on', '```'].join('\n');
    expect(parseGovernance(md).flags).toEqual({ sec: true, arch: true });
  });
});

describe('profile markdown render', () => {
  const profile: ProjectAiProfile = {
    version: 1,
    repo: 'acme/lib',
    defaultBranch: 'main',
    languages: ['TypeScript'],
    issueTemplates: ['.github/ISSUE_TEMPLATE/bug.yml'],
    ciCommands: ['npm run typecheck', 'npm test'],
    hasCi: true,
    restrictions: [],
  };

  it('renders the canonical sections', () => {
    const md = renderProfileMarkdown(profile);
    expect(md).toContain('# Project AI Profile');
    expect(md).toContain('repo: `acme/lib`');
    expect(md).toContain('default_branch: `main`');
    expect(md).toContain('- TypeScript');
    expect(md).toContain('- .github/ISSUE_TEMPLATE/bug.yml');
    expect(md).toContain('pr_template: MISSING');
    expect(md).toContain('- npm run typecheck');
    expect(md).toContain('workflows present');
  });
});