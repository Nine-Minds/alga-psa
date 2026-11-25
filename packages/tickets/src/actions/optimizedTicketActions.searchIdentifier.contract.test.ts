import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// T002 (ticket list): applyTicketListIndexedSearchFilter is not exported from a 'use server'
// module, so assert on its source: both queries bind exact and prefix identifiers separately
// and no LIKE uses the exact identifier.
const source = readFileSync(path.resolve(__dirname, 'optimizedTicketActions.ts'), 'utf8');

describe('ticket list search identifier (T002)', () => {
  it('derives identifiers with the shared helper, not a partial-chunk regex', () => {
    expect(source).toContain('deriveSearchIdentifierMatch(rawSearch)');
    expect(source).not.toContain('\\b[A-Z]+-?\\d+\\b');
  });

  it('uses identifier_prefix for every LIKE and identifier only for =', () => {
    expect(source).not.toMatch(/LIKE q\.identifier \|\|/);
    expect(source.match(/LIKE q\.identifier_prefix \|\| '%'/g)).toHaveLength(2);
    expect(source.match(/= q\.identifier\)/g)).toHaveLength(2);
    expect(source.match(/\?::text AS identifier_prefix/g)).toHaveLength(2);
    expect(source.match(/^\s+identifierPrefix,$/gm)).toHaveLength(2);
    expect(source.match(/^\s+!isFullNumber,$/gm)).toHaveLength(2);
    expect(source.match(/q\.fuzzy_enabled AND si\.title % q\.raw/g)).toHaveLength(2);
  });
});
