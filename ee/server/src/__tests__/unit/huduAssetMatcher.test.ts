/**
 * T210/T211/T212/T213 — pure asset auto-suggest matcher (F209/F210), no
 * mocks/DB/network.
 *
 * Priority: serial exact (1.0) → exact case-insensitive name (0.9) → fuzzy
 * normalized-Levenshtein name ≥ 0.8 (score). Blank serials never serial-match;
 * already-mapped Hudu/Alga assets are excluded; each Alga asset is claimed by
 * at most one suggestion.
 */

import { describe, expect, it } from 'vitest';

import {
  HUDU_EXACT_NAME_CONFIDENCE,
  HUDU_FUZZY_MATCH_THRESHOLD,
  huduNameSimilarity,
} from '../../lib/integrations/hudu/companyMapping';
import {
  HUDU_SERIAL_CONFIDENCE,
  suggestHuduAssetMappings,
} from '../../lib/integrations/hudu/assetMatching';

const ASSET_A = '11111111-1111-1111-1111-111111111111';
const ASSET_B = '22222222-2222-2222-2222-222222222222';
const ASSET_C = '33333333-3333-3333-3333-333333333333';

describe('T210: serial exact beats name matching', () => {
  it('suggests the serial-matched asset even when another asset matches by exact name', () => {
    const suggestions = suggestHuduAssetMappings(
      [{ id: 1, name: 'Front Desk PC', primary_serial: 'SN-001' }],
      [
        { asset_id: ASSET_B, asset_name: 'Front Desk PC', serial_number: 'SN-999' }, // exact name decoy
        { asset_id: ASSET_A, asset_name: 'Totally Different Name', serial_number: 'SN-001' },
      ],
      []
    );

    expect(suggestions.get(1)).toEqual({
      asset_id: ASSET_A,
      asset_name: 'Totally Different Name',
      source: 'serial',
      confidence: HUDU_SERIAL_CONFIDENCE,
    });
  });

  it('matches serials case-insensitively and trimmed', () => {
    const suggestions = suggestHuduAssetMappings(
      [{ id: 1, name: 'Whatever', primary_serial: '  sn-abc01 ' }],
      [{ asset_id: ASSET_A, asset_name: 'Whoever', serial_number: 'SN-ABC01' }],
      []
    );

    expect(suggestions.get(1)).toMatchObject({ asset_id: ASSET_A, source: 'serial' });
  });

  it('falls through to exact name at 0.9 when the serial matches no Alga asset', () => {
    const suggestions = suggestHuduAssetMappings(
      [{ id: 1, name: '  front desk PC ', primary_serial: 'SN-NOPE' }],
      [{ asset_id: ASSET_A, asset_name: 'Front Desk PC', serial_number: 'SN-001' }],
      []
    );

    expect(suggestions.get(1)).toEqual({
      asset_id: ASSET_A,
      asset_name: 'Front Desk PC',
      source: 'exact_name',
      confidence: HUDU_EXACT_NAME_CONFIDENCE,
    });
  });
});

describe('T211: fuzzy name respects the 0.8 threshold and legal-suffix stripping', () => {
  it("ignores trailing legal-entity suffixes so 'Mail Server Ltd' matches 'Mail Server' at 1.0 (fuzzy source)", () => {
    expect(huduNameSimilarity('Mail Server Ltd', 'Mail Server')).toBe(1);

    const suggestions = suggestHuduAssetMappings(
      [{ id: 3, name: 'Mail Server Ltd' }],
      [{ asset_id: ASSET_A, asset_name: 'Mail Server' }],
      []
    );

    expect(suggestions.get(3)).toMatchObject({ asset_id: ASSET_A, source: 'fuzzy_name', confidence: 1 });
  });

  it('suggests a misspelled name with confidence between the threshold and 0.9', () => {
    const suggestions = suggestHuduAssetMappings(
      [{ id: 4, name: 'Vandelay Fileserver' }],
      [{ asset_id: ASSET_B, asset_name: 'Vandalay Fileservre' }],
      []
    );

    const suggestion = suggestions.get(4);
    expect(suggestion).toMatchObject({ asset_id: ASSET_B, source: 'fuzzy_name' });
    expect(suggestion!.confidence).toBeGreaterThanOrEqual(HUDU_FUZZY_MATCH_THRESHOLD);
    expect(suggestion!.confidence).toBeLessThan(HUDU_EXACT_NAME_CONFIDENCE);
  });

  it('returns no suggestion when nothing crosses 0.8', () => {
    expect(huduNameSimilarity('Warehouse AP', 'Conference Room TV')).toBeLessThan(HUDU_FUZZY_MATCH_THRESHOLD);

    const suggestions = suggestHuduAssetMappings(
      [{ id: 5, name: 'Warehouse AP' }],
      [
        { asset_id: ASSET_A, asset_name: 'Conference Room TV' },
        { asset_id: ASSET_B, asset_name: 'Reception Printer' },
      ],
      []
    );

    expect(suggestions.size).toBe(0);
  });

  it('handles empty inputs', () => {
    expect(suggestHuduAssetMappings([], [], []).size).toBe(0);
    expect(suggestHuduAssetMappings([{ id: 1, name: 'Switch' }], [], []).size).toBe(0);
    expect(suggestHuduAssetMappings([], [{ asset_id: ASSET_A, asset_name: 'Switch' }], []).size).toBe(0);
  });
});

describe('T212: blank serials never serial-match (F210)', () => {
  it('empty-string serials on both sides do not serial-match, but the pair may still name-match', () => {
    const suggestions = suggestHuduAssetMappings(
      [{ id: 1, name: 'Office Switch', primary_serial: '' }],
      [{ asset_id: ASSET_A, asset_name: 'Office Switch', serial_number: '' }],
      []
    );

    expect(suggestions.get(1)).toEqual({
      asset_id: ASSET_A,
      asset_name: 'Office Switch',
      source: 'exact_name',
      confidence: HUDU_EXACT_NAME_CONFIDENCE,
    });
  });

  it('null/missing/whitespace serials never match each other', () => {
    const suggestions = suggestHuduAssetMappings(
      [
        { id: 1, name: 'Alpha', primary_serial: null },
        { id: 2, name: 'Beta' },
        { id: 3, name: 'Gamma', primary_serial: '   ' },
      ],
      [
        { asset_id: ASSET_A, asset_name: 'No Name Match One', serial_number: null },
        { asset_id: ASSET_B, asset_name: 'No Name Match Two', serial_number: '   ' },
        { asset_id: ASSET_C, asset_name: 'No Name Match Three' },
      ],
      []
    );

    expect(suggestions.size).toBe(0);
  });
});

describe('T213: greedy one-to-one claiming and exclusions', () => {
  it('never suggests the same Alga asset for two Hudu assets', () => {
    const suggestions = suggestHuduAssetMappings(
      [
        { id: 1, name: 'Domain Controller' },
        { id: 2, name: 'DOMAIN CONTROLLER' },
      ],
      [{ asset_id: ASSET_A, asset_name: 'Domain Controller' }],
      []
    );

    expect(suggestions.get(1)).toMatchObject({ asset_id: ASSET_A, source: 'exact_name' });
    expect(suggestions.has(2)).toBe(false);
  });

  it('skips already-mapped Hudu assets even when a perfect serial match exists', () => {
    const suggestions = suggestHuduAssetMappings(
      [{ id: 1, name: 'Core Router', primary_serial: 'SN-001' }],
      [
        { asset_id: ASSET_A, asset_name: 'Core Router', serial_number: 'SN-001' },
        { asset_id: ASSET_B, asset_name: 'Backup Router' },
      ],
      [{ asset_id: ASSET_B, hudu_asset_id: 1 }]
    );

    expect(suggestions.size).toBe(0);
  });

  it('excludes already-mapped Alga assets as suggestion targets', () => {
    const suggestions = suggestHuduAssetMappings(
      [{ id: 2, name: 'Edge Firewall' }],
      [
        { asset_id: ASSET_A, asset_name: 'Edge Firewall' }, // mapped elsewhere
        { asset_id: ASSET_B, asset_name: 'Edge Firewalls' },
      ],
      [{ asset_id: ASSET_A, hudu_asset_id: 999 }]
    );

    // The exact-name asset is taken; the fuzzy candidate wins instead.
    expect(suggestions.get(2)).toMatchObject({ asset_id: ASSET_B, source: 'fuzzy_name' });
  });

  it('a higher-priority serial claim wins over a later name claim for the same asset', () => {
    const suggestions = suggestHuduAssetMappings(
      [
        { id: 1, name: 'Mail Gateway' }, // exact name vs ASSET_A
        { id: 2, name: 'Unrelated Box', primary_serial: 'SN-77' }, // serial vs ASSET_A
      ],
      [{ asset_id: ASSET_A, asset_name: 'Mail Gateway', serial_number: 'SN-77' }],
      []
    );

    expect(suggestions.get(2)).toMatchObject({ asset_id: ASSET_A, source: 'serial' });
    expect(suggestions.has(1)).toBe(false);
  });
});
