import { describe, expect, it } from 'vitest';
import { blockNoteToPlainText } from './blocknoteUtils';

const p = (text: string) => ({ type: 'paragraph', props: { textColor: 'default' }, content: [{ type: 'text', text, styles: {} }], children: [] });
const emptyP = { type: 'paragraph', props: {}, content: [], children: [] };

describe('blockNoteToPlainText', () => {
  it('joins paragraphs with a space', () => {
    expect(blockNoteToPlainText(JSON.stringify([p('Printer is down'), p('Second floor')]))).toBe('Printer is down Second floor');
  });

  it('flattens nested inline content (links, styled runs)', () => {
    const doc = [{ type: 'paragraph', content: [
      { type: 'text', text: 'See ', styles: { bold: true } },
      { type: 'link', href: 'https://x.test', content: [{ type: 'text', text: 'the docs', styles: {} }] },
    ], children: [] }];
    expect(blockNoteToPlainText(doc)).toBe('See the docs');
  });

  it('flattens lists and nested children without ids or props', () => {
    const doc = [
      { id: 'a1', type: 'bulletListItem', props: { textColor: 'red' }, content: [{ type: 'text', text: 'one', styles: {} }], children: [
        { id: 'a2', type: 'numberedListItem', props: {}, content: [{ type: 'text', text: 'nested', styles: {} }], children: [] },
      ] },
      { id: 'a3', type: 'bulletListItem', props: {}, content: [{ type: 'text', text: 'two', styles: {} }], children: [] },
    ];
    const out = blockNoteToPlainText(JSON.stringify(doc));
    expect(out).toBe('one nested two');
    expect(out).not.toContain('textColor');
  });

  it('treats a document of only empty paragraphs as empty', () => {
    expect(blockNoteToPlainText(JSON.stringify([emptyP, emptyP]))).toBe('');
    expect(blockNoteToPlainText([emptyP])).toBe('');
  });

  it('returns invalid JSON / unknown shapes as trimmed text without throwing', () => {
    expect(blockNoteToPlainText('[{"type": "paragraph", oops')).toBe('[{"type": "paragraph", oops');
    expect(blockNoteToPlainText('[urgent] fix printer')).toBe('[urgent] fix printer');
    expect(blockNoteToPlainText('{"foo": 1}')).toBe('{"foo": 1}');
    expect(blockNoteToPlainText({ foo: 1 })).toBe('');
    expect(blockNoteToPlainText(undefined)).toBe('');
    expect(blockNoteToPlainText(null)).toBe('');
    expect(() => blockNoteToPlainText(Symbol('x') as unknown)).not.toThrow();
  });

  it('is idempotent on plain text', () => {
    for (const text of ['Reset password for Bob', 'null', '123', 'true', '[1,2]']) {
      expect(blockNoteToPlainText(text)).toBe(text);
      expect(blockNoteToPlainText(blockNoteToPlainText(text))).toBe(text);
    }
  });

  it('truncates at a word boundary with an ellipsis', () => {
    const out = blockNoteToPlainText('alpha beta gamma delta epsilon', 14);
    expect(out).toBe('alpha beta…');
    expect(blockNoteToPlainText(out, 14)).toBe(out);
  });

  it('does not truncate text within the limit', () => {
    expect(blockNoteToPlainText('short text', 160)).toBe('short text');
  });

  it('defaults to a 160-character limit', () => {
    const long = Array.from({ length: 60 }, () => 'word').join(' ');
    const out = blockNoteToPlainText(long);
    expect(out.length).toBeLessThanOrEqual(161);
    expect(out.endsWith('…')).toBe(true);
  });
});
