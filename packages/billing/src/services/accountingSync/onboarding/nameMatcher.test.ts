import { describe, it, expect } from 'vitest';
import { normalizeBusinessName, matchCustomers } from './nameMatcher';

// ─── normalizeBusinessName ───────────────────────────────────────────────────

describe('normalizeBusinessName', () => {
  it('lowercases, trims, and collapses whitespace', () => {
    expect(normalizeBusinessName('  ACME  Corp  ')).toBe('acme');
  });

  it('strips punctuation characters: . , & \' - ( )', () => {
    expect(normalizeBusinessName("O'Brien & Sons, Inc.")).toBe('obrien sons');
  });

  it('folds legal suffix: LLC', () => {
    expect(normalizeBusinessName('Foo Bar LLC')).toBe('foo bar');
  });

  it('folds multiple trailing suffixes: Corp Ltd', () => {
    expect(normalizeBusinessName('Acme Corp Ltd')).toBe('acme');
  });

  it('folds all specified suffixes', () => {
    const suffixes = ['inc', 'incorporated', 'llc', 'llp', 'ltd', 'limited', 'corp', 'corporation', 'co', 'company', 'gmbh', 'plc'];
    for (const suffix of suffixes) {
      expect(normalizeBusinessName(`Foo ${suffix}`)).toBe('foo');
    }
  });

  it('does NOT strip suffix that is not a trailing whole word', () => {
    // "incorporated" inside the name should stay
    expect(normalizeBusinessName('Incorporated Solutions')).toBe('incorporated solutions');
  });

  it('returns empty string for empty input', () => {
    expect(normalizeBusinessName('')).toBe('');
  });

  it('handles name with only suffix words', () => {
    // "LLC" alone normalises to ''
    expect(normalizeBusinessName('LLC')).toBe('');
  });
});

// ─── matchCustomers ──────────────────────────────────────────────────────────

describe('matchCustomers', () => {
  const makeClients = (names: string[]) =>
    names.map((name, i) => ({ id: `c${i + 1}`, name }));

  const makeCustomers = (names: string[], active = true) =>
    names.map((name, i) => ({ id: `q${i + 1}`, name, active }));

  it('exact match: same normalised name → in exact list', () => {
    const clients = makeClients(['Acme Corp']);
    const customers = makeCustomers(['ACME CORP']);
    const { exact, suggestions } = matchCustomers(clients, customers);
    expect(exact).toHaveLength(1);
    expect(exact[0]).toMatchObject({ clientId: 'c1', externalId: 'q1' });
    expect(suggestions).toHaveLength(0);
  });

  it('collision: two clients map to same customer → neither exact, both suggestions', () => {
    const clients = makeClients(['Acme Corp', 'Acme Corporation']);
    const customers = makeCustomers(['Acme']);
    const { exact, suggestions } = matchCustomers(clients, customers);
    expect(exact).toHaveLength(0);
    // both clients produce a suggestion entry for q1
    const suggestionClientIds = suggestions.map((s) => s.clientId);
    expect(suggestionClientIds).toContain('c1');
    expect(suggestionClientIds).toContain('c2');
  });

  it('does not match against inactive customers for exact', () => {
    const clients = makeClients(['Acme Corp']);
    const customers = [{ id: 'q1', name: 'Acme Corp', active: false }];
    const { exact } = matchCustomers(clients, customers);
    expect(exact).toHaveLength(0);
  });

  it('suggestion scoring: Jaccard ≥ 0.5', () => {
    const clients = makeClients(['Foo Bar Baz']);
    // "Foo Bar" → normalised "foo bar"; shared tokens with "foo bar baz" = {foo, bar}, union = {foo, bar, baz} → 2/3 ≈ 0.67
    const customers = makeCustomers(['Foo Bar']);
    const { suggestions } = matchCustomers(clients, customers);
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions[0].score).toBeGreaterThanOrEqual(0.5);
  });

  it('unrelated names produce no matches', () => {
    const clients = makeClients(['Alpha Technologies']);
    const customers = makeCustomers(['Gamma Plumbing']);
    const { exact, suggestions } = matchCustomers(clients, customers);
    expect(exact).toHaveLength(0);
    expect(suggestions).toHaveLength(0);
  });

  it('suggestions capped at 3 per client', () => {
    const clients = makeClients(['Acme']);
    // 5 customers all sharing "acme" token
    const customers = [
      { id: 'q1', name: 'Acme Alpha', active: true },
      { id: 'q2', name: 'Acme Beta', active: true },
      { id: 'q3', name: 'Acme Gamma', active: true },
      { id: 'q4', name: 'Acme Delta', active: true },
      { id: 'q5', name: 'Acme Epsilon', active: true }
    ];
    const { suggestions } = matchCustomers(clients, customers);
    const clientSuggestions = suggestions.filter((s) => s.clientId === 'c1');
    expect(clientSuggestions.length).toBeLessThanOrEqual(3);
  });

  it('suggestions are sorted by score descending', () => {
    const clients = makeClients(['Foo Bar']);
    const customers = [
      { id: 'q1', name: 'Foo Bar Baz', active: true }, // Jaccard({foo,bar}, {foo,bar,baz}) = 2/3
      { id: 'q2', name: 'Foo', active: true }           // Jaccard({foo,bar}, {foo}) = 1/2
    ];
    const { suggestions } = matchCustomers(clients, customers);
    expect(suggestions[0].score).toBeGreaterThanOrEqual(suggestions[1]?.score ?? 0);
  });
});
