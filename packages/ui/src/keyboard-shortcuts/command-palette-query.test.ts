import { describe, expect, it } from 'vitest';
import { parseCommandPaletteQuery } from './command-palette-query';

describe('command palette query parser', () => {
  it('parses field aliases and leading sigils', () => {
    const parsed = parseCommandPaletteQuery('t:123 client:Acme p:"big project" @alex >close /settings #456');

    expect(parsed.terms.map((term) => [term.field, term.value, term.phrase])).toEqual([
      ['ticket', '123', false],
      ['client', 'Acme', false],
      ['project', 'big project', true],
      ['user', 'alex', false],
      ['action', 'close', false],
      ['nav', 'settings', false],
      ['ticket', '456', false],
    ]);
  });

  it('parses exclusion, wildcards, fuzzy terms, and leading wildcard errors', () => {
    const parsed = parseCommandPaletteQuery('status:"in progress" -closed NOT stale open* jo?n alex~ *bad');

    expect(parsed.terms).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: undefined, value: 'closed', exclude: true }),
      expect.objectContaining({ value: 'stale', exclude: true }),
      expect.objectContaining({ value: 'open*', wildcard: true }),
      expect.objectContaining({ value: 'jo?n', wildcard: true }),
      expect.objectContaining({ value: 'alex', fuzzy: true }),
      expect.objectContaining({ value: '*bad', error: 'leading-wildcard' }),
    ]));
    expect(parsed.defaultOperator).toBe('OR');
    expect(parsed.scopedOperator).toBe('AND');
  });

  it('parses magic keyword aliases', () => {
    expect(parseCommandPaletteQuery('$mine $m $recent $rec $open').terms.map((term) => term.magic)).toEqual([
      'mine',
      'mine',
      'recent',
      'recent',
      'open',
    ]);
  });
});
