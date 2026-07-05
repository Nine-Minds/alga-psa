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

describe('contract line service basic tenant-scoped query contract', () => {
  it('uses structural tenant scoping for basic CRUD and validation roots', () => {
    const basicSection = sectionBetween('// BASIC CRUD OPERATIONS WITH VALIDATION', '// PLAN CONFIGURATION MANAGEMENT');
    const helperSection = sectionBetween('private buildContractLineQuery', 'private async isPlanInUse');

    expect(source).not.toContain('createTenantScopedQuery');
    expect(basicSection).toContain('tenantDb(');
    expect(helperSection).toContain('tenantDb(');
    expect(helperSection).toContain('tenantDb(');
    expect(helperSection).toContain(".table('contract_lines as cl')");
    expect(helperSection).toContain(".table('contract_lines')");

    expect(basicSection).not.toMatch(/trx\('contract_lines'\)\s*\.(?:where|update|delete)/);
    expect(helperSection).not.toMatch(/knex\('contract_lines(?: as cl)?'\)\s*\./);
    expect(helperSection).not.toMatch(/trx\('contract_lines'\)\s*\.(?:where|first)/);
    expect(basicSection).not.toMatch(/\.where\('tenant', context\.tenant\)/);
    expect(helperSection).not.toMatch(/\.where\('(?:cl\.)?tenant', context\.tenant\)/);
  });
});
