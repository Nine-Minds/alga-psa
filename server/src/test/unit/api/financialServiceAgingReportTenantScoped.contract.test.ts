import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const servicePath = resolve(__dirname, '../../../lib/api/services/FinancialService.ts');
const source = readFileSync(servicePath, 'utf8');

function sectionBetween(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return source.slice(start, end);
}

describe('financial service aging report tenant-scoped query contract', () => {
  it('uses structural tenant scoping for aging report roots', () => {
    const agingSection = sectionBetween('async getAgingReport', 'async getFinancialAnalytics');

    expect(agingSection).toContain('tenantDb(');
    expect(agingSection).toContain(".table('invoices as i')");
    expect(agingSection).toContain('const tenant = context?.tenant || defaultTenant;');
    expect(agingSection).toContain("scopedDb.tenantJoin(query, 'clients as c', 'i.client_id', 'c.client_id')");

    expect(agingSection).not.toMatch(/knex\('invoices as i'\)\s*\./);
    expect(agingSection).not.toMatch(/\.where\('i\.tenant', tenant\)/);
  });
});
