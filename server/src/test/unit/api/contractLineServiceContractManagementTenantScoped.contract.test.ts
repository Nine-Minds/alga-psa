import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const servicePath = resolve(__dirname, '../../../lib/api/services/ContractLineService.ts');
const source = readFileSync(servicePath, 'utf8');

function sectionBetween(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return source.slice(start, end);
}

describe('contract line service contract-management tenant-scoped query contract', () => {
  it('uses structural tenant scoping for contract list and assignment guard roots', () => {
    const contractSection = sectionBetween('// CONTRACT MANAGEMENT', '// COMPANY ASSIGNMENT OPERATIONS');

    expect(contractSection).toContain('createTenantScopedQuery(knex, {');
    expect(contractSection).toContain('createTenantScopedQuery(trx, {');
    expect(contractSection).toContain("table: 'contracts as c'");
    expect(contractSection).toContain("table: 'client_contracts as cc'");

    expect(contractSection).not.toMatch(/knex\('contracts as c'\)\s*\./);
    expect(contractSection).not.toMatch(/trx\('client_contracts as cc'\)\s*\./);
    expect(contractSection).not.toMatch(/\.where\(\{\s*'c\.tenant': context\.tenant\s*\}\)/);
    expect(contractSection).not.toMatch(/\.where\('cc\.tenant', context\.tenant\)/);
  });
});
