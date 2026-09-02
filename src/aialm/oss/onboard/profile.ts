/**
 * aialm-oss-onboard — Project AI Profile collector.
 *
 * Każde pole jest zbierane z publicznych artefaktów albo jawnie MISSING —
 * nigdy nie wymyślone.
 */
import type { GithubClient } from '../adapter/github.js';

export interface ProjectAiProfile {
  version: number;
  repo: string; // owner/name
  defaultBranch?: string;
  languages: string[];
  contributing?: string;
  issueTemplates: string[];
  prTemplate?: string;
  ciCommands: string[];
  /** False gdy brak workflow GitHub Actions (CI nieobecny). */
  hasCi: boolean;
  restrictions: string[];
}

const LANGUAGE_PROBES: Array<[string, string]> = [
  ['package.json', 'TypeScript/JavaScript'],
  ['tsconfig.json', 'TypeScript'],
  ['requirements.txt', 'Python'],
  ['pyproject.toml', 'Python'],
  ['Cargo.toml', 'Rust'],
  ['go.mod', 'Go'],
  ['pom.xml', 'Java'],
  ['build.gradle', 'Java/Kotlin'],
];

const ISSUE_TEMPLATE_DIRS = ['.github/ISSUE_TEMPLATE', 'ISSUE_TEMPLATE'];
const CONTRIBUTING_PATHS = ['CONTRIBUTING.md', '.github/CONTRIBUTING.md', 'docs/CONTRIBUTING.md'];
const PR_TEMPLATE_PATHS = ['.github/PULL_REQUEST_TEMPLATE.md', 'PULL_REQUEST_TEMPLATE.md'];

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 3)}...`;
}

export class ProfileCollector {
  constructor(private gh: GithubClient) {}

  async collect(owner: string, repo: string): Promise<ProjectAiProfile> {
    const info = await this.gh.getRepo(owner, repo);
    const branch = info.default_branch;

    const languages = await this.collectLanguages(owner, repo);
    if (info.language && !languages.includes(info.language)) languages.push(info.language);

    let contributing: string | undefined;
    for (const p of CONTRIBUTING_PATHS) {
      const c = await this.gh.getFile(owner, repo, p, branch);
      if (c) { contributing = truncate(c, 8000); break; }
    }

    const issueTemplates = await this.collectIssueTemplates(owner, repo, branch);

    let prTemplate: string | undefined;
    for (const p of PR_TEMPLATE_PATHS) {
      const t = await this.gh.getFile(owner, repo, p, branch);
      if (t) { prTemplate = truncate(t, 4000); break; }
    }

    const workflowCommands = await this.gh
      .collectWorkflowCommands(owner, repo, branch)
      .catch(() => []);
    const hasCi = workflowCommands.length > 0;
    const pkgScripts = await this.collectPkgScriptCommands(owner, repo, branch);
    const ciCommands = hasCi ? workflowCommands : pkgScripts;

    return {
      version: 1,
      repo: info.full_name,
      defaultBranch: branch,
      languages,
      issueTemplates,
      ciCommands,
      hasCi,
      restrictions: [],
      ...(contributing ? { contributing } : {}),
      ...(prTemplate ? { prTemplate } : {}),
    };
  }

  private async collectLanguages(owner: string, repo: string): Promise<string[]> {
    const langs = new Set<string>();
    for (const [probe, label] of LANGUAGE_PROBES) {
      const hit = await this.gh.getFile(owner, repo, probe);
      if (hit !== undefined) langs.add(label);
    }
    return [...langs];
  }

  private async collectIssueTemplates(owner: string, repo: string, ref?: string): Promise<string[]> {
    const found: string[] = [];
    for (const dir of ISSUE_TEMPLATE_DIRS) {
      const entries = await this.gh.listDir(owner, repo, dir, ref).catch(() => []);
      for (const e of entries.filter(e => e.type === 'file')) {
        found.push(`${dir}/${e.name}`);
      }
      if (found.length) break;
    }
    return [...new Set(found)];
  }

  private async collectPkgScriptCommands(owner: string, repo: string, ref?: string): Promise<string[]> {
    const pkg = await this.gh.getFile(owner, repo, 'package.json', ref);
    if (!pkg) return [];
    try {
      const json = JSON.parse(pkg) as { scripts?: Record<string, string> };
      const scripts = json.scripts ?? {};
      const wanted = ['typecheck', 'test', 'build'];
      const out: string[] = [];
      for (const w of wanted) {
        if (typeof scripts[w] === 'string' && scripts[w]!.trim()) out.push(`npm run ${w}`);
      }
      return out;
    } catch {
      return [];
    }
  }
}