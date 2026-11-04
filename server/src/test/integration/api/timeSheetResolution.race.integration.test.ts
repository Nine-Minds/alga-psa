import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import { findOrCreateTimeSheetRow } from '@alga-psa/scheduling/lib/timeSheetResolution';

/** The UI/stopwatch fetch-or-create resolver must converge on one sheet without aborting callers' transactions. */

let db: Knex;
const tenants = new Set<string>();
const t = (tenant: string, table: string) => tenantDb(db, tenant).table(table);
const fixtureTenants = () => tenantDb(db, '__fixture__').unscoped('tenants', 'test fixture');

async function seed() {
  const tenant = uuidv4();
  tenants.add(tenant);
  await fixtureTenants().insert({ tenant, client_name: `Res ${tenant.slice(0, 8)}`, email: `r-${tenant.slice(0, 8)}@example.com` });
  const userId = uuidv4();
  await t(tenant, 'users').insert({
    tenant, user_id: userId, username: `r-${userId.slice(0, 8)}`, hashed_password: 'x', user_type: 'internal',
    email: `r-${userId.slice(0, 8)}@example.com`, first_name: 'Res', last_name: 'Olver',
  });
  const periodId = uuidv4();
  await t(tenant, 'time_periods').insert({ period_id: periodId, tenant, start_date: '2026-04-06', end_date: '2026-04-13' });
  return { tenant, userId, periodId };
}

describe('findOrCreateTimeSheetRow races', () => {
  beforeAll(async () => { db = await createTestDbConnection(); }, 180_000);
  afterEach(async () => {
    for (const tenant of tenants) {
      await t(tenant, 'time_sheets').del();
      await t(tenant, 'time_periods').del();
      await t(tenant, 'users').del();
      await fixtureTenants().where({ tenant }).del();
    }
    tenants.clear();
  });
  afterAll(async () => { await db?.destroy(); });

  it('returns an existing sheet in any status without changing it', async () => {
    const f = await seed();
    const id = uuidv4();
    await t(f.tenant, 'time_sheets').insert({ tenant: f.tenant, id, user_id: f.userId, period_id: f.periodId, approval_status: 'APPROVED' });
    const row = await findOrCreateTimeSheetRow(db, f.tenant, f.userId, f.periodId);
    expect(row).toMatchObject({ id, approval_status: 'APPROVED' });
  });

  it('concurrent calls on independent connections return the same sheet id', async () => {
    const f = await seed();
    const rows = await Promise.all(Array.from({ length: 8 }, () => findOrCreateTimeSheetRow(db, f.tenant, f.userId, f.periodId)));
    expect(new Set(rows.map((r) => r.id)).size).toBe(1);
    expect(await t(f.tenant, 'time_sheets').where({ user_id: f.userId })).toHaveLength(1);
  });

  it('losing the race inside a caller-owned transaction does not abort that transaction', async () => {
    const f = await seed();
    // A competing writer holds an uncommitted insert; the caller's insert-ignore waits on it,
    // sees the commit, ignores, and reads the winner in a later statement.
    const winner = await db.transaction();
    const winnerId = uuidv4();
    await tenantDb(winner, f.tenant).table('time_sheets').insert({
      tenant: f.tenant, id: winnerId, user_id: f.userId, period_id: f.periodId, approval_status: 'DRAFT',
    });

    const caller = await db.transaction();
    const pending = findOrCreateTimeSheetRow(caller, f.tenant, f.userId, f.periodId);
    // Wait until the caller is actually blocked on the winner's row before releasing it.
    const deadline = Date.now() + 15_000;
    for (;;) {
      const { rows } = await db.raw("SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'transactionid' AND NOT granted");
      if (rows[0].n >= 1) break;
      if (Date.now() > deadline) throw new Error('caller never blocked on the competing insert');
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    await winner.commit();

    const row = await pending;
    expect(row.id).toBe(winnerId);
    // The caller's transaction is still usable.
    const { rows } = await caller.raw('SELECT 1 AS ok');
    expect(rows[0].ok).toBe(1);
    await tenantDb(caller, f.tenant).table('time_sheets').where({ id: winnerId }).first();
    await caller.commit();
    expect(await t(f.tenant, 'time_sheets').where({ user_id: f.userId })).toHaveLength(1);
  });
});
