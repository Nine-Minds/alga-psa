/**
 * Compile-only SQL-shape test (no DB): the tenant facade must emit the tenant
 * distribution-key equality on the write-off report's users join. Citus rejects
 * co-located distributed outer joins without it — this exact missing predicate
 * was the production write-off report failure (see
 * docs/plans/2026-07-06-inventory-citus-errors-plan.md).
 */
import { describe, expect, it } from 'vitest';
import knexLib from 'knex';
import { tenantDb } from '@alga-psa/db';

describe('inventoryReportingActions SQL shape', () => {
  const knex = knexLib({ client: 'pg' });
  const TENANT = '00000000-0000-0000-0000-000000000001';

  it('write-off users join carries the tenant distribution key (inferred, no rootTenantColumn)', () => {
    const scopedDb = tenantDb(knex, TENANT);
    const q = scopedDb.table('stock_movements as sm');
    scopedDb.tenantJoin(q, 'users as u', 'u.user_id', 'sm.performed_by', { type: 'left' });
    const { sql } = q.select('sm.movement_id').toSQL();

    expect(sql).toContain('left join "users" as "u"');
    expect(sql).toContain('"u"."tenant" = "sm"."tenant"');
  });

  it('write-off location joins carry the tenant distribution key on both aliases', () => {
    const scopedDb = tenantDb(knex, TENANT);
    const q = scopedDb.table('stock_movements as sm');
    scopedDb.tenantJoin(q, 'stock_locations as floc', 'floc.location_id', 'sm.from_location_id', { type: 'left' });
    scopedDb.tenantJoin(q, 'stock_locations as tloc', 'tloc.location_id', 'sm.to_location_id', { type: 'left' });
    const { sql } = q.select('sm.movement_id').toSQL();

    expect(sql).toContain('"floc"."tenant" = "sm"."tenant"');
    expect(sql).toContain('"tloc"."tenant" = "sm"."tenant"');
  });
});
