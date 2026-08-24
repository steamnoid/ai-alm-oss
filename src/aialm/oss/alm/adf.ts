/** Minimal ADF (Atlassian Document Format) builders — the only shapes we emit. */

export type AdfNode = { type: string; [k: string]: unknown };
export type AdfRun = string | { t: string; b?: boolean; c?: boolean };

function run(r: AdfRun) {
  if (typeof r === 'string') return { type: 'text', text: r };
  const marks =
    r.b || r.c ? [{ type: r.b ? 'strong' : 'code' }] : undefined;
  return marks
    ? { type: 'text', text: r.t, marks }
    : { type: 'text', text: r.t };
}

export function doc(...content: AdfNode[]): AdfNode {
  return { type: 'doc', version: 1, content };
}

export function para(...runs: AdfRun[]): AdfNode {
  return {
    type: 'paragraph',
    content: runs.length ? runs.map(run) : [{ type: 'text', text: ' ' }],
  };
}

export function heading(level: 1 | 2 | 3 | 4, text: string): AdfNode {
  return { type: 'heading', attrs: { level }, content: [{ type: 'text', text }] };
}

export function bullets(items: AdfRun[][]): AdfNode {
  return {
    type: 'bulletList',
    content: items.map(runs => ({
      type: 'listItem',
      content: [{ type: 'paragraph', content: runs.map(run) }],
    })),
  };
}

export function codeBlock(text: string): AdfNode {
  return { type: 'codeBlock', content: [{ type: 'text', text }] };
}

export function quote(text: string): AdfNode {
  return { type: 'blockquote', content: [para(text)] };
}
