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
  /** https://xxx.atlassian.net */
  site: string;
  email: string;
  token: string;
}

/** Jira Cloud REST config for the repo's OWN tracking project (per-klient). */
export function jiraConfig(): JiraConfig {
  loadDotEnv();
  const site = requireEnv('JIRA_SITE').replace(/\/$/, '');
  return { site, email: requireEnv('JIRA_EMAIL'), token: requireEnv('JIRA_TOKEN') };
}