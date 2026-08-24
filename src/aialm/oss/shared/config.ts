import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let loaded = false;

/** Load .env from project root (once). Never overrides existing process.env. */
export function loadDotEnv(root = process.cwd()): void {
  if (loaded) return;
  loaded = true;
  let raw: string;
  try {
    raw = readFileSync(resolve(root, '.env'), 'utf8');
  } catch {
    return;
  }
  for (const line of raw.split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    const key = m[1] as string;
    const value = (m[2] as string).replace(/^["']|["']$/g, '').trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) throw new Error(`Missing required env var: ${name}`);
  return v.trim();
}

export interface JiraConfig {
  site: string; // https://xxx.atlassian.net
  email: string;
  token: string;
}

export function jiraConfig(): JiraConfig {
  loadDotEnv();
  const site = requireEnv('JIRA_SITE').replace(/\/$/, '');
  return { site, email: requireEnv('JIRA_EMAIL'), token: requireEnv('JIRA_TOKEN') };
}

export interface GithubConfig {
  token: string; // may be empty — unauthenticated public-repo reads (60 req/h)
}

/**
 * Token for GitHub REST API (issues read, PR create).
 * Repo content operations (clone/branch/commit/push) use plain `git` over SSH —
 * no token involved. Without GITHUB_TOKEN, public reads work unauthenticated.
 */
export function githubConfig(): GithubConfig {
  loadDotEnv();
  return { token: process.env.GITHUB_TOKEN?.trim() ?? '' };
}

export function hasGithubConfig(): boolean {
  loadDotEnv();
  return Boolean(process.env.GITHUB_TOKEN?.trim());
}
