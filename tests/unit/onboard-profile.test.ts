import { describe, expect, it, vi } from 'vitest';
import { ProfileCollector } from '../../src/aialm/oss/onboard/profile.ts';
import type { GithubClient } from '../../src/aialm/oss/github/github.ts';

function ghStub(files: Record<string, string | null>, dirs: Record<string, string[]> = {}) {
  return {
    getRepo: vi.fn(async () => ({
      full_name: 'acme/widgets',
      default_branch: 'main',
      fork: false,
      html_url: 'https://github.com/acme/widgets',
      language: 'TypeScript',
    })),
    getFile: vi.fn(async (_o: string, _r: string, path: string) =>
      path in files ? files[path]! : (null as never),
    ),
    listDir: vi.fn(async (_o: string, _r: string, path: string) => {
      if (path in dirs) return dirs[path]!;
      throw Object.assign(new Error('404'), { status: 404 });
    }),
  } as unknown as GithubClient;
}

describe('ProfileCollector', () => {
  it('collects languages via probes and repo primary language', async () => {
    const collector = new ProfileCollector(
      ghStub({ 'package.json': '{}', 'Cargo.toml': '[package]' }),
    );
    const p = await collector.collect('acme', 'widgets');
    expect(p.languages).toContain('TypeScript');
    expect(p.languages).toContain('Rust');
    expect(p.repo).toBe('acme/widgets');
    expect(p.defaultBranch).toBe('main');
  });

  it('records contributing when present, undefined when missing', async () => {
    const withC = await new ProfileCollector(
      ghStub({ 'CONTRIBUTING.md': '# Contribute\nBe nice.' }),
    ).collect('acme', 'widgets');
    expect(withC.contributing).toContain('Be nice');

    const withoutC = await new ProfileCollector(ghStub({})).collect('acme', 'widgets');
    expect(withoutC.contributing).toBeUndefined();
  });

  it('lists issue templates from .github/ISSUE_TEMPLATE', async () => {
    const collector = new ProfileCollector(ghStub({}, { '.github/ISSUE_TEMPLATE': ['bug.md', 'feat.yml'] }));
    const p = await collector.collect('acme', 'widgets');
    expect(p.issueTemplates).toEqual(['.github/ISSUE_TEMPLATE/bug.md', '.github/ISSUE_TEMPLATE/feat.yml']);
  });

  it('extracts run: commands from workflows, deduped, no echo lines', async () => {
    const wf = `
name: CI
on: [push]
jobs:
  build:
    steps:
      - run: echo "hello"
      - run: npm ci
      - run: npm test
      - run: npm ci
`;
    const stub = ghStub({ '.github/workflows/ci.yml': wf }, { '.github/workflows': ['ci.yml'] });
    const collector = new ProfileCollector(stub);
    const p = await collector.collect('acme', 'widgets');
    expect(p.ciCommands).toEqual(['npm ci', 'npm test']);
  });

  it('never invents missing fields', async () => {
    const p = await new ProfileCollector(ghStub({})).collect('acme', 'widgets');
    expect(p.contributing).toBeUndefined();
    expect(p.prTemplate).toBeUndefined();
    expect(p.issueTemplates).toEqual([]);
    expect(p.ciCommands).toEqual([]);
    expect(p.restrictions).toEqual([]);
  });
});
