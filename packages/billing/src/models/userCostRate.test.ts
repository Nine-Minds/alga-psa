import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildCostRateResolutionLateralJoin, CostRateValidationError } from './userCostRate';

const testDir = path.dirname(fileURLToPath(import.meta.url));

function readModel(): string {
  return readFileSync(path.resolve(testDir, 'userCostRate.ts'), 'utf8');
}

describe('UserCostRate model contracts', () => {
  it('builds deterministic single-row rate resolution SQL with user-specific rates before defaults', () => {
    const sql = buildCostRateResolutionLateralJoin('te', 'rate');

    expect(sql).toContain('LEFT JOIN LATERAL');
    expect(sql).toContain('FROM user_cost_rates ucr');
    expect(sql).toContain('ucr.tenant = te.tenant');
    expect(sql).toContain('(ucr.user_id = te.user_id OR ucr.user_id IS NULL)');
    expect(sql).toContain('ucr.effective_from <= te.work_date');
    expect(sql).toContain('ucr.effective_to IS NULL OR ucr.effective_to >= te.work_date');
    expect(sql).toContain('ORDER BY ucr.user_id IS NULL, ucr.effective_from DESC, ucr.rate_id');
    expect(sql).toContain('LIMIT 1');
  });

  it('rejects unsafe SQL aliases in the reusable rate-resolution helper', () => {
    expect(() => buildCostRateResolutionLateralJoin('time_entries; drop table users')).toThrow(
      'SQL aliases must be simple identifiers'
    );
  });

  it('serializes writers with an advisory transaction lock before overlap validation', () => {
    const source = readModel();
    const lockIndex = source.indexOf("pg_advisory_xact_lock(hashtext(?))");
    const overlapIndex = source.indexOf('await this.assertNoOverlap');

    expect(lockIndex).toBeGreaterThan(-1);
    expect(overlapIndex).toBeGreaterThan(lockIndex);
    expect(source).toContain("return `${tenant}:${userId ?? 'default'}`");
  });

  it('uses the inclusive overlap predicate and scopes overlaps by user/default', () => {
    const source = readModel();

    expect(source).toContain("where('effective_from', '<=', knexOrTrx.raw('COALESCE(?::date, \\'infinity\\'::date)'");
    expect(source).toContain("andWhereRaw('?::date <= COALESCE(effective_to, \\'infinity\\'::date)'");
    expect(source).toContain("query.whereNull('user_id')");
    expect(source).toContain("query.where({ user_id: input.user_id })");
    expect(source).toContain("query.andWhere('rate_id', '<>', input.rate_id)");
  });

  it('enforces model-layer user integrity instead of relying on Citus-hostile FKs', () => {
    const source = readModel();

    expect(source).toContain('async assertInternalUserExists');
    expect(source).toContain("where({ user_id: userId, user_type: 'internal' })");
    expect(source).toContain("throw new CostRateValidationError('user_not_found'");
  });

  it('surfaces typed validation errors', () => {
    const error = new CostRateValidationError('overlap', 'Overlap');

    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('overlap');
    expect(error.message).toBe('Overlap');
  });
});
