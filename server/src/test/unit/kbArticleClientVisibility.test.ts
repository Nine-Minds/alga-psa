import { describe, expect, it } from 'vitest';
import {
  buildKbArticleContentFromTicket,
  isKbArticleClientVisible,
} from '@alga-psa/shared/models/kbArticleModel';

const STATUSES = ['draft', 'review', 'published', 'archived'] as const;
const AUDIENCES = ['internal', 'client', 'public'] as const;

describe('isKbArticleClientVisible truth table', () => {
  for (const status of STATUSES) {
    for (const audience of AUDIENCES) {
      const expected = status === 'published' && audience !== 'internal';
      it(`${status} + ${audience} => ${expected}`, () => {
        expect(isKbArticleClientVisible({ status, audience })).toBe(expected);
      });
    }
  }

  it('is false for unknown values', () => {
    expect(isKbArticleClientVisible({ status: 'paused', audience: 'client' })).toBe(false);
    expect(isKbArticleClientVisible({ status: 'published', audience: 'staff' })).toBe(false);
  });
});

describe('buildKbArticleContentFromTicket', () => {
  const text = (b: any) => b.content?.[0]?.text;

  it('splices BlockNote JSON blocks under Problem', () => {
    const blocks = [
      { type: 'paragraph', content: [{ type: 'text', text: 'Printer offline', styles: { bold: true } }] },
      { type: 'bulletListItem', content: [{ type: 'text', text: 'Check cable', styles: {} }] },
    ];
    const out = buildKbArticleContentFromTicket({ attributes: { description: JSON.stringify(blocks) } });
    expect(out).toHaveLength(5);
    expect(text(out[0])).toBe('Problem');
    expect(out[1]).toEqual(blocks[0]);
    expect(out[2]).toEqual(blocks[1]);
    expect(text(out[3])).toBe('Resolution');
    expect(text(out[4])).toBe('Enter resolution details here.');
  });

  it('turns plain text into a paragraph', () => {
    const out = buildKbArticleContentFromTicket({ attributes: { description: 'Cannot log in' } });
    expect(text(out[1])).toBe('Cannot log in');
    expect(out[1].type).toBe('paragraph');
  });

  it('uses the placeholder when the description is empty or missing', () => {
    for (const attributes of [null, {}, { description: '' }, { description: '   ' }]) {
      const out = buildKbArticleContentFromTicket({ attributes } as any);
      expect(text(out[1])).toBe('No description provided.');
    }
  });
});
