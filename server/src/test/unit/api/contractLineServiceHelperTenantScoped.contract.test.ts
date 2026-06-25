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

describe('contract line service helper tenant-scoped query contract', () => {
  it('uses structural tenant scoping for helper read and update roots', () => {
    const helperSection = sectionBetween('private async isPlanInUse', 'private async copyPlanServices');

    expect(helperSection).toContain('createTenantScopedQuery(knex, {');
    expect(helperSection).toContain('createTenantScopedQuery(trx, {');
    expect(helperSection).toContain("table: 'contract_lines as clx'");
    expect(helperSection).toContain("table: 'contract_line_service_configuration'");
    expect(helperSection).toContain("table: 'contract_lines'");
    expect(helperSection).toContain("table: 'contracts'");
    expect(helperSection).toContain("table: 'clients'");
    expect(helperSection).toContain("table: 'invoices'");
    expect(helperSection).toContain("table: 'bucket_usage'");
    expect(helperSection).toContain("table: 'service_catalog'");
    expect(helperSection).toContain(".andOn('cl.tenant', '=', 'cc.tenant')");

    expect(helperSection).not.toMatch(/knex\('contract_lines as clx'\)\s*\./);
    expect(helperSection).not.toMatch(/trx\('contract_line_service_configuration'\)\s*\.(?:where|first|update|delete)/);
    expect(helperSection).not.toMatch(/trx\('contract_lines'\)\s*\.(?:where|update|delete)/);
    expect(helperSection).not.toMatch(/trx\('contracts'\)\s*\.(?:where|first)/);
    expect(helperSection).not.toMatch(/trx\('clients'\)\s*\.(?:where|first)/);
    expect(helperSection).not.toMatch(/trx\('invoices'\)\s*\.(?:where|first|count)/);
    expect(helperSection).not.toMatch(/trx\('bucket_usage'\)\s*\.(?:where|first|count)/);
    expect(helperSection).not.toMatch(/trx\('service_catalog'\)\s*\.(?:where|first)/);
    expect(helperSection).not.toMatch(/\.where\('(?:clx\.)?tenant', context\.tenant\)/);
  });
});
