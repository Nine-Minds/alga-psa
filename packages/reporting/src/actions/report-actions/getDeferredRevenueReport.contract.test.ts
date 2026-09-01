import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./getDeferredRevenueReport.ts', import.meta.url), 'utf8');

function deferredRevenueSection(): string {
  const start = source.indexOf('export const getDeferredRevenueReport');
  expect(start).toBeGreaterThanOrEqual(0);
  return source.slice(start);
}

describe('deferred revenue report action contract', () => {
  it('gates on internal-user + reports.read permission independently of the page', () => {
    const section = deferredRevenueSection();

    expect(section).toContain('assertCanReadDeferredRevenueReport(user, knex)');
    expect(source).toContain("user.user_type !== 'internal'");
    expect(source).toContain("hasPermission(user, 'reports', 'read', knex)");
    expect(source).toContain("throw new Error('Permission denied");
  });

  it('is a withAuth server action and returns reporting error shapes', () => {
    const section = deferredRevenueSection();

    expect(section).toContain('withAuth(');
    expect(source).toContain("'use server';");
    expect(source).toContain('ReportingActionError');
    expect(source).toContain('reportingActionErrorFrom(error)');
  });

  it('validates the month parameter before touching the database', () => {
    const section = deferredRevenueSection();

    expect(section).toContain('InputSchema.safeParse(input)');
    expect(source).toContain('isValidMonth');
  });

  it('derives everything live from the ledgers — no snapshot tables', () => {
    const section = deferredRevenueSection();

    expect(section).toContain('buildDeferredRevenueReport(knex, tenant,');
    expect(section).not.toContain('snapshot');
    expect(section).not.toContain('deferred_revenue_report');
  });
});
