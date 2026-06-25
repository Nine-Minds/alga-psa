import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const servicePath = resolve(__dirname, '../../../lib/api/services/InvoiceService.ts');
const source = readFileSync(servicePath, 'utf8');

function sectionBetween(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return source.slice(start, end);
}

describe('invoice service statistics tenant-scoped query contract', () => {
  it('uses structural tenant scoping and tenant-equal client joins for statistics', () => {
    const statisticsSection = sectionBetween('async getStatistics', '// Missing Methods - Stub Implementations');
    const statisticsHelperSection = sectionBetween('private async getStatusStatistics', '// Alias Methods for Controller Compatibility');

    expect(statisticsSection).toContain('createTenantScopedQuery(trx, {');
    expect(statisticsSection).toContain("table: 'invoices'");
    expect(statisticsSection).not.toMatch(/trx\('invoices'\)\.where\('tenant', context\.tenant\)/);

    expect(statisticsHelperSection).toContain(".join('clients', function()");
    expect(statisticsHelperSection).toContain(".andOn('invoices.tenant', '=', 'clients.tenant')");
    expect(statisticsHelperSection).not.toContain(".join('clients', 'invoices.client_id', 'clients.client_id')");
  });
});
