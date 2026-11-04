import { describe, it, expect } from 'vitest';
import { runRegistrySearch, toRegistrySearchHit } from '../searchResult';
import type { ChatApiRegistryEntry } from '../schema';

const PLACEHOLDER =
  'This operation was generated automatically from the route inventory. Replace with canonical OpenAPI metadata.';

function entry(
  e: Partial<ChatApiRegistryEntry> &
    Pick<ChatApiRegistryEntry, 'id' | 'method' | 'path' | 'displayName'>,
): ChatApiRegistryEntry {
  return { tags: [], approvalRequired: false, parameters: [], ...e };
}

const BODY = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    phone_numbers: { type: 'array', items: { type: 'object', properties: { phone: { type: 'string' } } } },
  },
};

const CREATE = entry({
  id: 'contacts.create',
  method: 'post',
  path: '/api/v1/contacts',
  displayName: 'Create Contact',
  summary: 'Create a contact',
  description: 'Creates a new contact record.',
  tags: ['Contacts'],
  approvalRequired: true,
  requestBodySchema: BODY,
  examples: [
    { name: 'first', request: { body: { name: 'A' } } },
    { name: 'second', request: { body: { name: 'B' } } },
  ],
});
const LIST = entry({
  id: 'contacts.list',
  method: 'get',
  path: '/api/v1/contacts',
  displayName: 'List Contacts',
  description: PLACEHOLDER,
  tags: ['Contacts'],
});

function hit(e: ChatApiRegistryEntry, score = 5) {
  return toRegistrySearchHit({ entry: e, score, matchedFields: [] });
}

describe('toRegistrySearchHit', () => {
  it('includes the full requestBodySchema', () => {
    expect(hit(CREATE).requestBodySchema).toEqual(BODY);
  });

  it('carries description/summary, uppercases method, rounds score, keeps first example only', () => {
    const h = hit(CREATE, 4.56789);
    expect(h.entryId).toBe('contacts.create');
    expect(h.method).toBe('POST');
    expect(h.summary).toBe('Create a contact');
    expect(h.description).toBe('Creates a new contact record.');
    expect(h.score).toBe(4.57);
    expect(h.approvalRequired).toBe(true);
    expect(h.examples).toHaveLength(1);
    expect(h.examples?.[0].name).toBe('first');
  });

  it('omits the placeholder description', () => {
    expect(hit(LIST).description).toBeUndefined();
  });

  it('leaves absent fields out after a JSON round-trip', () => {
    const parsed = JSON.parse(JSON.stringify(hit(LIST)));
    expect(parsed).not.toHaveProperty('requestBodySchema');
    expect(parsed).not.toHaveProperty('examples');
    expect(parsed).not.toHaveProperty('description');
    expect(parsed).not.toHaveProperty('summary');
    const empty = JSON.parse(JSON.stringify(hit({ ...LIST, examples: [] })));
    expect(empty).not.toHaveProperty('examples');
  });
});

describe('runRegistrySearch', () => {
  const MANY: ChatApiRegistryEntry[] = Array.from({ length: 40 }, (_, i) =>
    entry({ id: `widgets.get${i}`, method: 'get', path: `/api/v1/widgets/${i}`, displayName: `Get Widget ${i}`, tags: ['Widgets'] }),
  );

  it('returns an envelope with hits', () => {
    const r = runRegistrySearch([CREATE, LIST], { query: 'create contact' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.query).toBe('create contact');
    expect(r.data.count).toBe(r.data.results.length);
    expect(r.data.results[0].entryId).toBe('contacts.create');
    expect(r.data.results[0].requestBodySchema).toEqual(BODY);
  });

  it('defaults limit to 5, caps at 25, falls back to 5 on garbage', () => {
    const count = (limit: unknown) => {
      const r = runRegistrySearch(MANY, { query: 'widget', limit });
      if (!r.ok) throw new Error('unexpected');
      return r.data.count;
    };
    expect(count(undefined)).toBe(5);
    expect(count(1000)).toBe(25);
    expect(count('abc')).toBe(5);
    expect(count(NaN)).toBe(5);
    expect(count(0)).toBe(1);
    expect(count(3)).toBe(3);
  });

  it('rejects empty, whitespace and non-string queries', () => {
    for (const query of ['', '   ', undefined, 42]) {
      const r = runRegistrySearch([CREATE], { query });
      expect(r).toEqual({ ok: false, error: 'search_api_registry requires a non-empty "query".' });
    }
  });

  it('adds a note only when the top score is below 3', () => {
    const only = entry({ id: 'x.y', method: 'get', path: '/api/v1/zzz', displayName: 'Zzz' });
    const weak = runRegistrySearch([only], { query: 'qqqunmatched' });
    const strong = runRegistrySearch([only], { query: 'zzz' });
    const none = runRegistrySearch([], { query: 'zzz' });
    if (!weak.ok || !strong.ok || !none.ok) throw new Error('unexpected');
    expect(weak.data.results[0].score).toBeLessThan(3);
    expect(weak.data.note).toMatch(/Low match confidence/);
    expect(strong.data.results[0].score).toBeGreaterThanOrEqual(3);
    expect(strong.data.note).toBeUndefined();
    expect(none.data.count).toBe(0);
    expect(none.data.note).toBeUndefined();
  });
});
