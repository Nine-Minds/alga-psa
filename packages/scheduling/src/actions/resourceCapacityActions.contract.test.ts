import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./resourceCapacityActions.ts', import.meta.url), 'utf8');

function section(exportName: string): string {
  const start = source.indexOf(`export const ${exportName}`);
  expect(start).toBeGreaterThanOrEqual(0);
  const rest = source.slice(start + 1);
  const next = rest.indexOf('\nexport const ');
  return next === -1 ? rest : rest.slice(0, next);
}

describe('resource capacity actions contract', () => {
  it('runs both actions through withAuth and the tenant-scoped builder', () => {
    expect(source).toContain('export const getUserCapacity = withAuth(');
    expect(source).toContain('export const updateUserCapacity = withAuth(');
    expect(source).toContain('tenantDb(db, tenant).table(\'resources\')');
    expect(source).toContain('tenantDb(trx, tenant)');
    expect(source).not.toContain("db('resources')");
    expect(source).not.toContain("trx('resources')");
  });

  it('gates reads and writes on the matching user permission', () => {
    expect(section('getUserCapacity')).toContain("hasPermission(user, 'user', 'read', db)");
    expect(section('updateUserCapacity')).toContain("hasPermission(user, 'user', 'update', db)");
  });

  it('validates the capacity before touching the database', () => {
    const update = section('updateUserCapacity');
    const validationAt = update.indexOf('parseWeeklyCapacityHours(maxWeeklyCapacity)');
    const writeAt = update.indexOf('withTransaction(');
    expect(validationAt).toBeGreaterThanOrEqual(0);
    expect(writeAt).toBeGreaterThan(validationAt);
    expect(update).toContain('weeklyCapacityRejectionMessage(parsed.reason)');
  });

  it('writes a single row per user inside one transaction', () => {
    const update = section('updateUserCapacity');
    expect(update).toContain('withTransaction(db, async (trx: Knex.Transaction) => {');
    // Update matches on user_id (not a single resource_id) and insert only runs
    // when nothing was updated, so a user never accumulates capacity rows.
    expect(update).toContain('.where({ user_id: userId })\n        .update({ max_weekly_capacity: capacity, updated_at: now })');
    expect(update).toContain('if (!updated) {');
  });
});
