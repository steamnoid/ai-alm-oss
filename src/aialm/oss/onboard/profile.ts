import type { GithubClient } from '../github/github.ts';
import type { ProjectAiProfile } from '../shared/models.ts';

/**
 * Project AI Profile collectors (aialm-oss-project-onboard).
 * Every field is either collected from public artifacts or explicitly MISSING — never invented.
 */

const LANGUAGE_PROBES: [string, string][] = [
  ['package.json', 'TypeScript/JavaScript'],
  ['tsconfig.json', 'TypeScript'],
  ['requirements.txt', 'Python'],
  ['pyproject.toml', 'Python'],
  ['Cargo.toml', 'Rust'],
  ['go.mod', 'Go'],
  ['pom.xml', 'Java'],
  ['build.gradle', 'Java/Kotlin'],
];

const ISSUE_TEMPLATE_DIRS = ['.github/ISSUE_TEMPLATE', '.github', 'ISSUE_TEMPLATE'];

export class ProfileCollector {
  constructor(private gh: GithubClient) {}

  async collect(owner: string, repo: string): Promise<ProjectAiProfile> {
    const repoInfo = await this.gh.getRepo(owner, repo);
    const full = repoInfo.full_name; // canonical casing

    const languages = await this.collectLanguages(owner, repo, repoInfo.language ?? '');
    const contributing =
      (await this.gh.getFile(owner, repo, 'CONTRIBUTING.md')) ??
      (await this.gh.getFile(owner, repo, '.github/CONTRIBUTING.md')) ??
      (await this.gh.getFile(owner, repo, 'docs/CONTRIBUTING.md'));
    const issueTemplates = await this.collectIssueTemplates(owner, repo);
    const prTemplate =
      (await this.gh.getFile(owner, repo, '.github/PULL_REQUEST_TEMPLATE.md')) ??
      (await this.gh.getFile(owner, repo, 'PULL_REQUEST_TEMPLATE.md')) ??
      undefined;
    const ciCommands = await this.collectCiCommands(owner, repo);
    const hasCi = ciCommands.hasWorkflow;
    const commands = ciCommands.commands;
    const pkgScripts = await this.collectPkgScriptCommands(owner, repo);

    return {
      version: 1,
      repo: full,
      defaultBranch: repoInfo.default_branch,
      languages,
      structure: [], // filled by tree scan when needed
      contributing: contributing ? truncate(contributing, 8000) : undefined,
      issueTemplates,
      prTemplate: prTemplate ? truncate(prTemplate, 4000) : undefined,
      conventions: { coding: [], test: [] }, // refined by dev-analyst phase
      ciCommands: commands.length ? commands : pkgScripts,
      hasCi,
      docsRefs: [],
      labelConventions: [],
      maintainerExpectations: [],
      restrictions: [],
    };
  }

  private async collectLanguages(owner: string, repo: string, primary: string): Promise<string[]> {
    const found = new Set<string>();
    if (primary) found.add(primary);
    await Promise.all(
      LANGUAGE_PROBES.map(async ([path, lang]) => {
        try {
          if (await this.gh.getFile(owner, repo, path)) found.add(lang);
        } catch {
          /* probe failures are non-fatal */
        }
      }),
    );
    return [...found];
  }

  private async collectIssueTemplates(owner: string, repo: string): Promise<string[]> {
    for (const dir of ISSUE_TEMPLATE_DIRS) {
      try {
        const list = await this.gh.listDir(owner, repo, dir);
        const md = list.filter(f => f.endsWith('.md') || f.endsWith('.yml'));
        if (md.length) return md.map(f => `${dir}/${f}`);
      } catch {
        /* try next dir */
      }
    }
    return [];
  }

  /**
   * Extract shell commands from GitHub workflow files (`run:` lines).
   * MVP heuristic — no YAML dependency; deduped, order-preserving.
   * Reports whether a workflow exists at all (CI detection).
   */
  private async collectCiCommands(owner: string, repo: string): Promise<{ hasWorkflow: boolean; commands: string[] }> {
    let files: string[];
    try {
      files = await this.gh.listDir(owner, repo, '.github/workflows');
    } catch {
      return { hasWorkflow: false, commands: [] };
    }
    const commands = new Set<string>();
    for (const f of files.filter(x => x.endsWith('.yml') || x.endsWith('.yaml'))) {
      const raw = await this.gh.getFile(owner, repo, `.github/workflows/${f}`);
      if (!raw) continue;
      for (const m of raw.matchAll(/^\s*(?:-\s+)?run:\s*["']?(.+?)["']?\s*$/gm)) {
        const cmd = (m[1] as string).trim();
        if (cmd && !cmd.startsWith('echo')) commands.add(cmd);
      }
    }
    return { hasWorkflow: true, commands: [...commands].slice(0, 30) };
  }

  /**
   * Fallback: when the repo has no GitHub Actions, derive validation commands
   * from real `package.json` scripts (typecheck/test/build/lint) + npm ci.
   * Never invented — mirrors the actual scripts present.
   */
  private async collectPkgScriptCommands(owner: string, repo: string): Promise<string[]> {
    const pkg = await this.gh.getFile(owner, repo, 'package.json');
    if (!pkg) return [];
    let scripts: Record<string, string> = {};
    try {
      scripts = (JSON.parse(pkg) as { scripts?: Record<string, string> }).scripts ?? {};
    } catch {
      return [];
    }
    const preferred = ['typecheck', 'test', 'lint', 'build'];
    const out = ['npm ci'];
    for (const k of preferred) {
      if (typeof scripts[k] === 'string') out.push(k === 'test' ? 'npm test' : `npm run ${k}`);
    }
    return out;
  }
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}\n… (truncated)`;
}
