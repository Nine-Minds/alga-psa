import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./creditReconciliationReport.ts', import.meta.url), 'utf8');

function sectionBetween(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return source.slice(start, end);
}

describe('credit reconciliation report tenant-scoped query contract', () => {
  it('routes credit reconciliation report roots through tenantDb', () => {
    const createSection = sectionBetween('static async create(', 'static async getById');
    const readAndUpdateSection = sectionBetween('static async getById', 'static async listReports');
    const listSection = sectionBetween('static async listReports', 'static async resolveReport');
    const aggregateSection = sectionBetween('static async countOpenReports', 'export default CreditReconciliationReport');

    expect(source).toContain("import { createTenantKnex, tenantDb } from '@alga-psa/db';");
    expect(source).toContain("return tenantDb(conn, tenant).table<ICreditReconciliationReport>('credit_reconciliation_reports');");

    expect(createSection).toContain('tenantScopedReports(dbInstance, tenant)');
    expect(createSection).not.toContain("dbInstance('credit_reconciliation_reports')");

    expect(readAndUpdateSection).toContain('tenantScopedReports(knex, tenant)');
    expect(readAndUpdateSection).toContain('tenantScopedReports(dbInstance, tenant)');
    expect(readAndUpdateSection).not.toContain("knex('credit_reconciliation_reports')");
    expect(readAndUpdateSection).not.toContain("dbInstance('credit_reconciliation_reports')");
    expect(readAndUpdateSection).not.toContain('tenant\n        })');

    expect(listSection).toContain('const baseQuery = tenantScopedReports(knex, tenant);');
    expect(listSection).not.toContain("knex('credit_reconciliation_reports')");
    expect(listSection).not.toContain('.where({ tenant })');

    expect(aggregateSection).toContain('tenantScopedReports(knex, tenant)');
    expect(aggregateSection).not.toContain("knex('credit_reconciliation_reports')");
    expect(aggregateSection).not.toContain('tenant,');
    expect(aggregateSection).not.toContain('.where({ tenant })');
  });
});
