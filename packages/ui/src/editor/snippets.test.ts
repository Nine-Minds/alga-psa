import { describe, expect, it } from 'vitest';
import { buildSnippetSections, filterSnippets, flattenSnippetSections, stripBlockIds, type EditorSnippet } from './snippets';

const s = (id: string, extra: Partial<EditorSnippet> = {}): EditorSnippet => ({ id, title: id, ...extra });

describe('buildSnippetSections', () => {
  const snippets = [
    s('Reset password', { category: 'Account', lastUsedAt: '2026-10-01T00:00:00Z' }),
    s('Greeting', { isFavorite: true, category: 'General' }),
    s('Escalation', { category: 'Account' }),
    s('Closing', { lastUsedAt: '2026-10-05T00:00:00Z' }),
    s('Apology', { isFavorite: true, lastUsedAt: '2026-10-09T00:00:00Z' }),
    s('Refund', { category: 'billing' }),
  ];

  it('orders favorites, then recents, then categories', () => {
    expect(buildSnippetSections(snippets).map((x) => [x.key, x.category, x.items.map((i) => i.id)])).toEqual([
      ['favorites', null, ['Apology', 'Greeting']],
      ['recent', null, ['Closing', 'Reset password']],
      ['category', 'Account', ['Escalation']],
      ['category', 'billing', ['Refund']],
    ]);
  });

  it('shows each snippet once, so keyboard order has no duplicates', () => {
    const flat = flattenSnippetSections(buildSnippetSections(snippets)).map((i) => i.id);
    expect(new Set(flat).size).toBe(snippets.length);
  });

  it('puts uncategorized last and caps recents', () => {
    const many = Array.from({ length: 8 }, (_, i) => s(`r${i}`, { lastUsedAt: `2026-10-0${i + 1}T00:00:00Z` }));
    const sections = buildSnippetSections([...many, s('plain', { category: 'Zed' }), s('loose')]);
    expect(sections.find((x) => x.key === 'recent')!.items.map((i) => i.id)).toEqual(['r7', 'r6', 'r5', 'r4', 'r3']);
    const categories = sections.filter((x) => x.key === 'category');
    expect(categories[categories.length - 1].category).toBeNull();
  });

  it('merges categories case-insensitively', () => {
    const sections = buildSnippetSections([s('a', { category: 'Billing' }), s('b', { category: 'billing ' })]);
    expect(sections).toHaveLength(1);
    expect(sections[0].items).toHaveLength(2);
  });
});

describe('filterSnippets', () => {
  const list = [s('Greeting', { category: 'General', preview: 'Hello there' }), s('Refund', { category: 'Billing' })];
  it('matches title, category and preview, case-insensitively', () => {
    expect(filterSnippets(list, 'GREET').map((i) => i.id)).toEqual(['Greeting']);
    expect(filterSnippets(list, 'billing').map((i) => i.id)).toEqual(['Refund']);
    expect(filterSnippets(list, 'hello').map((i) => i.id)).toEqual(['Greeting']);
  });
  it('returns everything for an empty query', () => expect(filterSnippets(list, '  ')).toHaveLength(2));
});

describe('stripBlockIds', () => {
  it('removes block ids recursively but keeps other id-like fields', () => {
    const doc = [{ id: 'a', type: 'paragraph', props: { id: 'keep' }, content: [{ type: 'mention', props: { userId: 'u' } }], children: [{ id: 'b', type: 'paragraph', children: [] }] }];
    const stripped = stripBlockIds(doc) as any;
    expect(stripped[0].id).toBeUndefined();
    expect(stripped[0].children[0].id).toBeUndefined();
    expect(stripped[0].props.id).toBe('keep');
  });
});
