import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(),
  tenantDb: vi.fn(),
  withTransaction: vi.fn(),
  resolveUserTimeZone: vi.fn(),
}));
vi.mock('@alga-psa/auth', () => ({ withAuth: (action: unknown) => action, getSession: vi.fn(), hasPermission: vi.fn() }));
vi.mock('../src/models/timePeriod', () => ({ TimePeriod: {} }));
vi.mock('../src/models/timePeriodSettings', () => ({ TimePeriodSettings: {} }));

describe("'use server' time period actions", () => {
  it('no longer export createNextTimePeriod (a browser could call it with arbitrary settings)', async () => {
    const actions = await import('../src/actions/timePeriodsActions');
    expect(Object.keys(actions)).not.toContain('createNextTimePeriod');
    expect((actions as Record<string, unknown>).createNextTimePeriod).toBeUndefined();
  });

  it('keep the settings-taking job helper out of every action module', () => {
    const source = readFileSync(resolve(__dirname, '../src/actions/timePeriodsActions.ts'), 'utf8');
    expect(source).not.toMatch(/export\s+(async\s+)?function\s+createNextTimePeriod/);
    expect(source).not.toMatch(/createTimePeriodsThrough/);
  });

  it('expose the job entry point from a non-action module that takes no settings', () => {
    const source = readFileSync(resolve(__dirname, '../src/lib/timePeriodAutomation.ts'), 'utf8');
    expect(source).not.toMatch(/^\s*['"]use server['"]/m);
    expect(source).toMatch(/export async function createNextTimePeriod\(\s*db: Knex,\s*tenant: string,\s*daysThreshold/);
    expect(source).toMatch(/getActiveSettings/);
  });
});
