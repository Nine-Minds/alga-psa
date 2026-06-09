/**
 * T041/T042/T043 — pure auto-suggest matcher (F041), no mocks/DB/network.
 *
 * Priority: id_in_integration exact (1.0) → exact case-insensitive name (0.9)
 * → fuzzy normalized-Levenshtein name ≥ 0.8 (score). Already-mapped companies
 * and clients are excluded; each client is claimed by at most one suggestion.
 */

import { describe, expect, it } from 'vitest';

import {
  HUDU_EXACT_NAME_CONFIDENCE,
  HUDU_FUZZY_MATCH_THRESHOLD,
  HUDU_INTEGRATION_ID_CONFIDENCE,
  huduNameSimilarity,
  suggestHuduCompanyMappings,
} from '../../lib/integrations/hudu/companyMapping';

const CLIENT_A = '11111111-1111-1111-1111-111111111111';
const CLIENT_B = '22222222-2222-2222-2222-222222222222';
const CLIENT_C = '33333333-3333-3333-3333-333333333333';
const CLIENT_C_NAME = 'Globex Corporation';

describe('T041: id_in_integration beats name matching', () => {
  it('suggests the id_in_integration client even when another client matches by exact name', () => {
    const suggestions = suggestHuduCompanyMappings(
      [{ id: 1, name: 'Acme Corp', id_in_integration: CLIENT_B }],
      [
        { client_id: CLIENT_A, client_name: 'Acme Corp' }, // exact name decoy
        { client_id: CLIENT_B, client_name: 'Totally Different Name' },
      ],
      []
    );

    expect(suggestions.get(1)).toEqual({
      client_id: CLIENT_B,
      client_name: 'Totally Different Name',
      source: 'integration_id',
      confidence: HUDU_INTEGRATION_ID_CONFIDENCE,
    });
  });

  it('matches id_in_integration case-insensitively and as a string', () => {
    const suggestions = suggestHuduCompanyMappings(
      [{ id: 1, name: 'Whatever', id_in_integration: CLIENT_A.toUpperCase() }],
      [{ client_id: CLIENT_A, client_name: 'Whoever' }],
      []
    );

    expect(suggestions.get(1)).toMatchObject({ client_id: CLIENT_A, source: 'integration_id' });
  });

  it('falls through to name matching when id_in_integration matches no client (e.g. a foreign numeric PSA id)', () => {
    const suggestions = suggestHuduCompanyMappings(
      [{ id: 1, name: 'Acme Corp', id_in_integration: 4711 }],
      [{ client_id: CLIENT_A, client_name: 'Acme Corp' }],
      []
    );

    expect(suggestions.get(1)).toMatchObject({ client_id: CLIENT_A, source: 'exact_name' });
  });
});

describe('T042: exact-name then fuzzy-name fallbacks with lower confidence', () => {
  it('suggests an exact case-insensitive (trimmed) name match at 0.9', () => {
    const suggestions = suggestHuduCompanyMappings(
      [{ id: 2, name: '  acme CORP ' }],
      [{ client_id: CLIENT_A, client_name: 'Acme Corp' }],
      []
    );

    expect(suggestions.get(2)).toEqual({
      client_id: CLIENT_A,
      client_name: 'Acme Corp',
      source: 'exact_name',
      confidence: HUDU_EXACT_NAME_CONFIDENCE,
    });
  });

  it('falls back to a fuzzy name match with confidence between the threshold and 0.9', () => {
    const suggestions = suggestHuduCompanyMappings(
      [{ id: 3, name: 'Globex Corporation' }],
      [{ client_id: CLIENT_B, client_name: 'Globex Corporation Inc' }],
      []
    );

    const suggestion = suggestions.get(3);
    expect(suggestion).toMatchObject({ client_id: CLIENT_B, source: 'fuzzy_name' });
    expect(suggestion!.confidence).toBeGreaterThanOrEqual(HUDU_FUZZY_MATCH_THRESHOLD);
    expect(suggestion!.confidence).toBeLessThan(HUDU_EXACT_NAME_CONFIDENCE);
  });

  it('fuzzy normalization ignores punctuation/case so near-exact variants score 1.0 (still fuzzy source)', () => {
    expect(huduNameSimilarity('Acme, Corp.', 'ACME CORP')).toBe(1);

    const suggestions = suggestHuduCompanyMappings(
      [{ id: 4, name: 'Acme, Corp.' }],
      [{ client_id: CLIENT_A, client_name: 'ACME CORP' }],
      []
    );
    // Not an exact string match, so it lands in the fuzzy pass at score 1.0.
    expect(suggestions.get(4)).toMatchObject({ client_id: CLIENT_A, source: 'fuzzy_name', confidence: 1 });
  });
});

describe('T043: no suggestion below the fuzzy threshold', () => {
  it('returns no suggestion when nothing crosses 0.8', () => {
    expect(huduNameSimilarity('Initech', 'Globex Corporation')).toBeLessThan(HUDU_FUZZY_MATCH_THRESHOLD);

    const suggestions = suggestHuduCompanyMappings(
      [{ id: 5, name: 'Initech' }],
      [
        { client_id: CLIENT_A, client_name: 'Globex Corporation' },
        { client_id: CLIENT_B, client_name: 'Wayne Enterprises' },
      ],
      []
    );

    expect(suggestions.size).toBe(0);
  });

  it('handles empty inputs', () => {
    expect(suggestHuduCompanyMappings([], [], []).size).toBe(0);
    expect(suggestHuduCompanyMappings([{ id: 1, name: 'Acme' }], [], []).size).toBe(0);
    expect(suggestHuduCompanyMappings([], [{ client_id: CLIENT_A, client_name: 'Acme' }], []).size).toBe(0);
  });
});

describe('F041 exclusions: mapped companies/clients and one-to-one claiming', () => {
  it('skips already-mapped companies even when a perfect match exists', () => {
    const suggestions = suggestHuduCompanyMappings(
      [{ id: 1, name: 'Acme Corp', id_in_integration: CLIENT_A }],
      [
        { client_id: CLIENT_A, client_name: 'Acme Corp' },
        { client_id: CLIENT_B, client_name: 'Beta LLC' },
      ],
      [{ client_id: CLIENT_B, hudu_company_id: 1 }]
    );

    expect(suggestions.size).toBe(0);
  });

  it('excludes already-mapped clients as suggestion targets', () => {
    const suggestions = suggestHuduCompanyMappings(
      [{ id: 2, name: 'Acme Corporation' }],
      [
        { client_id: CLIENT_A, client_name: 'Acme Corporation' }, // mapped elsewhere
        { client_id: CLIENT_B, client_name: 'Acme Corporations' },
      ],
      [{ client_id: CLIENT_A, hudu_company_id: 999 }]
    );

    // The exact-name client is taken; the fuzzy candidate wins instead.
    expect(suggestions.get(2)).toMatchObject({ client_id: CLIENT_B, source: 'fuzzy_name' });
  });

  it('never suggests the same client for two companies (greedy one-to-one)', () => {
    const suggestions = suggestHuduCompanyMappings(
      [
        { id: 1, name: 'Acme Corp' },
        { id: 2, name: 'ACME CORP' },
      ],
      [{ client_id: CLIENT_A, client_name: 'Acme Corp' }],
      []
    );

    expect(suggestions.get(1)).toMatchObject({ client_id: CLIENT_A, source: 'exact_name' });
    expect(suggestions.has(2)).toBe(false);
  });

  it('a higher-priority claim wins over a later fuzzy claim for the same client', () => {
    const suggestions = suggestHuduCompanyMappings(
      [
        { id: 1, name: 'Globex Corporation Inc' }, // fuzzy vs CLIENT_C
        { id: 2, name: CLIENT_C_NAME }, // exact vs CLIENT_C
      ],
      [{ client_id: CLIENT_C, client_name: CLIENT_C_NAME }],
      []
    );

    expect(suggestions.get(2)).toMatchObject({ client_id: CLIENT_C, source: 'exact_name' });
    expect(suggestions.has(1)).toBe(false);
  });
});
