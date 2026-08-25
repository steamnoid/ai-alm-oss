import { describe, expect, it } from 'vitest';
import { doc, para, heading, bullets, codeBlock, quote, type AdfNode } from '../../src/aialm/oss/alm/adf.ts';
import { adfToPlainText } from '../../src/aialm/oss/alm/jira.ts';

describe('adf builders', () => {
  it('para renders marks (bold/code) and plain text', () => {
    const t = adfToPlainText(doc(para({ t: 'Title', b: true }, ' ', { t: 'key', c: true })));
    expect(t).toBe('Title key');
  });

  it('heading, bullets, codeBlock, quote flatten correctly', () => {
    const d = doc(
      heading(2, 'H2'),
      bullets([['a'], ['b']]),
      codeBlock('const x = 1;'),
      quote('quoted'),
    ) as AdfNode;
    const t = adfToPlainText(d);
    expect(t).toContain('H2');
    expect(t).toContain('const x = 1;');
    expect(t).toContain('quoted');
  });

  it('doc is a valid versioned doc node', () => {
    const d = doc(para('x'));
    expect(d.type).toBe('doc');
    expect(d.version).toBe(1);
    expect(Array.isArray(d.content)).toBe(true);
  });
});
