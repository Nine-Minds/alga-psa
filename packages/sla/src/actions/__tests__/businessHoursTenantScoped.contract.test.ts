import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(__dirname, '../businessHoursActions.ts'), 'utf8');

function sourceBetween(start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);

  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);

  return source.slice(startIndex, endIndex);
}

describe('business hours actions tenant-scoped query contract', () => {
  it('uses structural tenant scoping for schedule roots', () => {
    const scheduleSection = sourceBetween(
      '// Business Hours Schedules',
      '// Business Hours Entries',
    );

    expect(source).toContain("import { createTenantKnex, createTenantScopedQuery, withTransaction, normalizeIanaTimeZone } from '@alga-psa/db'");
    expect(source).toContain('function tenantScopedTable(trx: Knex.Transaction, table: string, tenant: string)');
    expect(scheduleSection).toContain("tenantScopedTable(trx, 'business_hours_schedules', tenant)");
    expect(scheduleSection).toContain("tenantScopedTable(trx, 'business_hours_entries', tenant)");
    expect(scheduleSection).toContain("tenantScopedTable(trx, 'holidays', tenant)");
    expect(scheduleSection).toContain("tenantScopedTable(trx, 'sla_policies', tenant)");
    expect(scheduleSection).not.toContain(".where({ tenant");
    expect(scheduleSection).not.toContain("trx('business_hours_schedules').where");
    expect(scheduleSection).not.toContain("trx('business_hours_entries').where");
    expect(scheduleSection).not.toContain("trx('holidays').where");
  });

  it('uses structural tenant scoping for entry and holiday roots', () => {
    const entryHolidaySection = sourceBetween(
      '// Business Hours Entries',
      '// Helper Functions',
    );

    expect(entryHolidaySection).toContain("tenantScopedTable(trx, 'business_hours_schedules', tenant)");
    expect(entryHolidaySection).toContain("tenantScopedTable(trx, 'business_hours_entries', tenant)");
    expect(entryHolidaySection).toContain("tenantScopedTable(trx, 'holidays', tenant)");
    expect(entryHolidaySection).not.toContain(".where({ tenant");
    expect(entryHolidaySection).not.toContain("trx('business_hours_schedules').where");
    expect(entryHolidaySection).not.toContain("trx('business_hours_entries').where");
    expect(entryHolidaySection).not.toContain("trx('holidays').where");
  });

  it('uses structural tenant scoping for defaults, calculators, and timezone roots', () => {
    const helperStart = source.indexOf('// Helper Functions');
    expect(helperStart).toBeGreaterThanOrEqual(0);
    const helperSection = source.slice(helperStart);

    expect(helperSection).toContain("tenantScopedTable(trx, 'tenant_settings', tenant)");
    expect(helperSection).toContain("tenantScopedTable(trx, 'business_hours_schedules', tenant)");
    expect(helperSection).toContain("tenantScopedTable(trx, 'business_hours_entries', tenant)");
    expect(helperSection).toContain("tenantScopedTable(trx, 'holidays', tenant)");
    expect(helperSection).not.toContain(".where({ tenant");
    expect(helperSection).not.toContain("trx('tenant_settings').where");
    expect(helperSection).not.toContain("trx('business_hours_schedules').where");
  });
});
