import { describe, expect, it } from 'vitest';
import {
  normalizeOrgName,
  findExactNameMatch,
} from '@ee/lib/integrations/huntress/organizations/nameMatch';

describe('normalizeOrgName', () => {
  it('lowercases, strips punctuation, collapses whitespace', () => {
    expect(normalizeOrgName('  Acme,  Inc.  ')).toBe('acme inc');
    expect(normalizeOrgName('ACME-INC')).toBe('acme inc');
    expect(normalizeOrgName("O'Brien & Sons LLC")).toBe('obrien sons llc');
  });

  it('returns empty string for empty/whitespace input', () => {
    expect(normalizeOrgName('')).toBe('');
    expect(normalizeOrgName('   ')).toBe('');
  });
});

describe('findExactNameMatch', () => {
  const clients = [
    { client_id: 'c1', client_name: 'Acme, Inc.' },
    { client_id: 'c2', client_name: 'Globex' },
    { client_id: 'c3', client_name: 'globex' },
  ];

  it('returns the client_id on a unique normalized match', () => {
    expect(findExactNameMatch('ACME INC', clients)).toBe('c1');
  });

  it('returns null when no client matches', () => {
    expect(findExactNameMatch('Initech', clients)).toBeNull();
  });

  it('returns null when the match is ambiguous (two clients normalize identically)', () => {
    expect(findExactNameMatch('Globex', clients)).toBeNull();
  });

  it('returns null for empty org names', () => {
    expect(findExactNameMatch('', clients)).toBeNull();
  });
});
