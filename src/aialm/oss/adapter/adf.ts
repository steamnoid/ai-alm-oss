/** ADF (Atlassian Document Format) helpers — structural only. */

export interface AdfDoc {
  type: 'doc';
  version: 1;
  content: unknown[];
}

export function asAdf(node: unknown): AdfDoc {
  const d = node as AdfDoc;
  if (!d || d.type !== 'doc') throw new Error('Not an ADF doc');
  return d;
}

/** Flatten ADF content to plain text (safe for markers / human reading). */
export function adfToPlainText(node: unknown): string {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(adfToPlainText).join('');
  const n = node as Record<string, unknown>;
  let out = '';
  if (typeof n.text === 'string') out += n.text;
  if (n.type === 'emoji' && typeof (n.attrs as Record<string, unknown> | undefined)?.text === 'string') {
    out += (n.attrs as { text: string }).text;
  }
  if (n.type === 'hardBreak' || n.type === 'blockquote') out += '\n';
  if (n.type === 'codeBlock') out += '\n';
  if (Array.isArray(n.content)) out += n.content.map(adfToPlainText).join('');
  return out;
}

/** Wrap markdown text into an ADF doc (single paragraph, hardBreak-separated lines). */
export function markdownToAdf(text: string): AdfDoc {
  const lines = text.split('\n');
  const content: unknown[] = [];
  lines.forEach((line, i) => {
    content.push({ type: 'text', text: line });
    if (i < lines.length - 1) content.push({ type: 'hardBreak' });
  });
  return { type: 'doc', version: 1, content: [{ type: 'paragraph', content }] };
}