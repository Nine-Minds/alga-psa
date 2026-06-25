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

describe('financial service account-balance tenant-scoped query contract', () => {
  it('uses structural tenant scoping for account-balance report roots', () => {
    const accountBalanceSection = sectionBetween('async getAccountBalanceReport', 'async getAgingReport');

    expect(accountBalanceSection).toContain('createTenantScopedQuery(knex, {');
    expect(accountBalanceSection).toContain("table: 'clients'");
    expect(accountBalanceSection).toContain("table: 'credit_tracking'");
    expect(accountBalanceSection).toContain("table: 'invoices'");
    expect(accountBalanceSection).toContain("table: 'transactions'");
    expect(accountBalanceSection).toContain('const tenant = context?.tenant || defaultTenant;');

    expect(accountBalanceSection).not.toMatch(/knex\('(?:clients|credit_tracking|invoices|transactions)'\)\s*\./);
    expect(accountBalanceSection).not.toMatch(/tenant:\s*(?:client\.tenant|context\?\.tenant|context\.tenant)/);
  });
});
