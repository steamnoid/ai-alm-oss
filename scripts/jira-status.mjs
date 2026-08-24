#!/usr/bin/env node
// Usage: node scripts/jira-status.mjs <ISSUE-KEY> <Status Name>
// Resolves the transition id for the target status name and applies it.
import { readFileSync } from 'node:fs';

const [key, ...rest] = process.argv.slice(2);
const statusName = rest.join(' ');
if (!key || !statusName) {
  console.error('usage: node scripts/jira-status.mjs <ISSUE-KEY> <Status Name>');
  process.exit(1);
}

const ctx = {};
for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) ctx[m[1]] = m[2].trim();
}
const base = ctx.JIRA_SITE.replace(/\/$/, '');
const auth = `Basic ${Buffer.from(`${ctx.JIRA_EMAIL}:${ctx.JIRA_TOKEN}`).toString('base64')}`;

async function jira(path, opts = {}) {
  const res = await fetch(`${base}${path}`, {
    ...opts,
    headers: { Authorization: auth, Accept: 'application/json', ...(opts.headers || {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${path}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : {};
}

const transitions = await jira(`/rest/api/3/issue/${encodeURIComponent(key)}/transitions`);
const t = (transitions.transitions ?? []).find(
  x => x.name.toLowerCase() === statusName.toLowerCase(),
);
if (!t) {
  console.error(
    `No transition to "${statusName}" on ${key}. Available: ${(transitions.transitions ?? [])
      .map(x => `${x.name}(${x.id})`)
      .join(', ')}`,
  );
  process.exit(1);
}
await jira(`/rest/api/3/issue/${encodeURIComponent(key)}/transitions`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ transition: { id: t.id } }),
});
console.log(`${key} -> ${t.name} (transition ${t.id})`);
