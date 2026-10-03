import { describe, expect, it } from 'vitest';

import { buildSynonymKeywords, getSearchSynonyms } from '../searchSynonyms';

describe('workflow search synonyms', () => {
  it('returns the word and its synonyms, normalized', () => {
    expect(getSearchSynonyms('Note')).toEqual(expect.arrayContaining(['note', 'comment', 'comments']));
    expect(getSearchSynonyms('replied')).toEqual(expect.arrayContaining(['reply', 'response', 'respond']));
    expect(getSearchSynonyms('xyzzy')).toEqual(['xyzzy']);
    expect(getSearchSynonyms('  ')).toEqual([]);
  });

  it('builds keyword text that finds an item by any synonym of its words', () => {
    const keywords = buildSynonymKeywords(['Ticket Customer Replied', 'TICKET_CUSTOMER_REPLIED', null]);
    expect(keywords).toContain('reply');
    expect(keywords).toContain('case');
    expect(keywords).toContain('client');
    expect(keywords).toContain('ticket customer replied');
  });

  it('maps ConnectWise wording to the matching terms', () => {
    expect(getSearchSynonyms('agreement')).toEqual(expect.arrayContaining(['contract', 'contracts']));
    expect(getSearchSynonyms('service ticket')).toEqual(expect.arrayContaining(['ticket', 'tickets']));
    expect(getSearchSynonyms('configuration')).toEqual(expect.arrayContaining(['asset', 'assets']));
    expect(buildSynonymKeywords(['Contract Renewal Upcoming'])).toContain('agreement');
  });
});
