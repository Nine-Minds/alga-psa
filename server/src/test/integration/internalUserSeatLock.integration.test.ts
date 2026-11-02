import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import knex, { type Knex } from 'knex';
import { randomUUID } from 'node:crypto';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { getSecret } from '../../lib/utils/getSecret';

// Real-Postgres proof that internal-user seat consumption is serialized by the
// per-tenant advisory xact lock taken in checkInternalUserLicenseLimit.
// Run: see docs in the commit message / the Draft Implementation fact.

import { runAsSystem, createSystemContext, runWithTenant } from '@alga-psa/db';
import { UserService } from '../../../../packages/users/src/services/UserService';
import {
  assertInternalUserSeatsWithinLimit,
  checkInternalUserLicenseLimit,
  lockInternalUserSeats,
} from '../../../../packages/users/src/lib/internalUserLicenseGuard';

let db: Knex;
// Stable scratch database: bootstrapping (migrations) takes minutes, so it is
// created once and reused (recreate:false). Drop it with SEAT_LOCK_TEST_DROP=1.
const databaseName = 'internal_user_seat_lock_test';

beforeAll(async () => {
  db = await createTestDbConnection({ databaseName, runSeeds: false, recreate: false });
  // UserService resolves its connection through the app's tenant pool, which
  // reads DB_* at call time: point it at the scratch database.
  process.env.DB_NAME_SERVER = databaseName;
}, 600_000);

afterAll(async () => {
  await db?.destroy();
  if (process.env.SEAT_LOCK_TEST_DROP !== '1') return;
  const admin = knex({ client: 'pg', connection: {
    host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER_ADMIN || 'postgres',
    password: await getSecret('postgres_password', 'DB_PASSWORD_ADMIN', 'postpass123'), database: 'postgres',
  }, pool: { min: 0, max: 1 } });
  try { await admin.raw('DROP DATABASE IF EXISTS ??', [databaseName]); }
  finally { await admin.destroy(); }
});

async function seedTenant(opts: { limit: number | null; plan?: string; product?: string }): Promise<string> {
  const tenant = randomUUID();
  await db('tenants').insert({
    tenant, client_name: 'Seats', email: `${tenant}@example.test`,
    product_code: opts.product ?? 'psa', licensed_user_count: opts.limit, plan: opts.plan ?? 'pro',
  });
  return tenant;
}
const seedUser = (tenant: string, email: string, inactive = false) => db('users').insert({
  tenant, user_id: randomUUID(), username: email, email, first_name: 'T', last_name: 'U',
  user_type: 'internal', hashed_password: 'unused', is_inactive: inactive,
});
const activeInternal = async (tenant: string) =>
  Number((await db('users').where({ tenant, user_type: 'internal', is_inactive: false }).count('* as c').first())!.c);

function createUser(tenant: string, email: string) {
  return runWithTenant(tenant, () => runAsSystem('seat-lock-test', async () =>
    new UserService().create(
      { username: email, email, password: 'Passw0rd!x', first_name: 'N', last_name: 'U', user_type: 'internal' },
      createSystemContext(tenant),
    )));
}

/** Backends currently blocked on a heavyweight lock (advisory or relation) in this test database. */
async function waitForBlockedBackends(count: number, timeoutMs = 20_000): Promise<number> {
  const start = Date.now();
  let seen = 0;
  while (Date.now() - start < timeoutMs) {
    const r = await db.raw(
      `SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`);
    seen = r.rows[0].n;
    if (seen >= count) return seen;
    await new Promise((res) => setTimeout(res, 50));
  }
  throw new Error(`only ${seen}/${count} backends blocked before timeout`);
}

describe('internal user seat lock', () => {
  it('race: 8 concurrent UserService.create at limit=2/used=1 admit exactly one', async () => {
    const tenant = await seedTenant({ limit: 2 });
    await seedUser(tenant, 'existing@example.test');

    // Hold ACCESS EXCLUSIVE on users from a separate connection. Every create
    // blocks in its seat-count read (with the lock: 1 on the table, 7 on the
    // advisory lock; without it: all 8 on the table). Only when 8 backends are
    // provably blocked do we release, so the overlap is real, not incidental.
    const holder = await db.transaction();
    await holder.raw('LOCK TABLE users IN ACCESS EXCLUSIVE MODE');

    const emails = Array.from({ length: 8 }, (_, i) => `racer${i}@example.test`);
    const attempts = emails.map((e) => createUser(tenant, e));
    const settled = Promise.allSettled(attempts);

    const blocked = await waitForBlockedBackends(8);
    expect(blocked).toBeGreaterThanOrEqual(8);
    await holder.commit();

    const results = await settled;
    const ok = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    console.log(`RACE RESULT: ${ok.length} succeeded, ${rejected.length} rejected (blocked=${blocked})`);

    expect(ok).toHaveLength(1);
    expect(rejected).toHaveLength(7);
    for (const r of rejected) expect(r.reason).toMatchObject({ code: 'LICENSE_LIMIT_REACHED' });
    // Assert on rows, not return values.
    expect(await activeInternal(tenant)).toBe(2);
    const racerRows = await db('users').where({ tenant }).whereIn('email', emails).count('* as c').first();
    expect(Number(racerRows!.c)).toBe(1);
  }, 60_000);

  it('race: concurrent UserService.update reactivations at limit=2/used=1 admit exactly one', async () => {
    const tenant = await seedTenant({ limit: 2 });
    await seedUser(tenant, 'existing@example.test');
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      const email = `dormant${i}@example.test`;
      await seedUser(tenant, email, true);
      ids.push((await db('users').where({ tenant, email }).first('user_id')).user_id);
    }
    const results = await Promise.allSettled(ids.map((id) => runWithTenant(tenant, () => runAsSystem('seat-lock-test', async () =>
      new UserService().update(id, { is_inactive: false } as any, createSystemContext(tenant))))));
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    console.log(`UPDATE RACE RESULT: ${results.length - rejected.length} succeeded, ${rejected.length} rejected`);
    expect(results.length - rejected.length).toBe(1);
    for (const r of rejected) expect(r.reason).toMatchObject({ code: 'LICENSE_LIMIT_REACHED' });
    expect(await activeInternal(tenant)).toBe(2);
  }, 60_000);

  it('UserService.update refuses a client -> internal change at the limit; bulk activation is all-or-nothing', async () => {
    const tenant = await seedTenant({ limit: 1 });
    await seedUser(tenant, 'owner@example.test');
    const clientEmail = 'portal@example.test';
    await db('users').insert({
      tenant, user_id: randomUUID(), username: clientEmail, email: clientEmail, first_name: 'T', last_name: 'U',
      user_type: 'client', hashed_password: 'unused', is_inactive: false,
    });
    const clientId = (await db('users').where({ tenant, email: clientEmail }).first('user_id')).user_id;
    await expect(runWithTenant(tenant, () => runAsSystem('seat-lock-test', async () =>
      new UserService().update(clientId, { user_type: 'internal' } as any, createSystemContext(tenant)))))
      .rejects.toMatchObject({ code: 'LICENSE_LIMIT_REACHED' });
    expect(await activeInternal(tenant)).toBe(1);

    await seedUser(tenant, 'dormant@example.test', true);
    const dormantId = (await db('users').where({ tenant, email: 'dormant@example.test' }).first('user_id')).user_id;
    await expect(runWithTenant(tenant, () => runAsSystem('seat-lock-test', async () =>
      new UserService().bulkDeactivateUsers([dormantId], false, createSystemContext(tenant)))))
      .rejects.toMatchObject({ code: 'LICENSE_LIMIT_REACHED' });
    expect(await activeInternal(tenant)).toBe(1);
  }, 60_000);

  it('honours reservedSeats (pending invitations count against the limit)', async () => {
    const tenant = await seedTenant({ limit: 3 });
    await seedUser(tenant, 'a@example.test');
    const check = (reservedSeats: number) =>
      db.transaction((trx) => checkInternalUserLicenseLimit(trx, tenant, { reservedSeats }));
    expect(await check(1)).toEqual({ ok: true });
    expect(await check(2)).toMatchObject({ ok: false, code: 'LICENSE_LIMIT_REACHED' });
  });

  it('solo plan: second user gets SOLO_PLAN_LIMIT', async () => {
    const tenant = await seedTenant({ limit: 5, plan: 'solo' });
    await createUser(tenant, 'first@example.test');
    await expect(createUser(tenant, 'second@example.test')).rejects.toMatchObject({ code: 'SOLO_PLAN_LIMIT' });
    expect(await activeInternal(tenant)).toBe(1);
  });

  it('deferCoManaged is unchanged: co-managed tenants defer, others do not', async () => {
    const co = await seedTenant({ limit: 1, product: 'co_managed' });
    await seedUser(co, 'x@example.test');
    expect(await db.transaction((trx) => checkInternalUserLicenseLimit(trx, co, { deferCoManaged: true })))
      .toEqual({ ok: true, coManaged: true });
    expect(await db.transaction((trx) => checkInternalUserLicenseLimit(trx, co)))
      .toMatchObject({ ok: false, code: 'LICENSE_LIMIT_REACHED' });
  });

  it('throws for a non-transaction caller', async () => {
    const tenant = await seedTenant({ limit: 5 });
    await expect(checkInternalUserLicenseLimit(db, tenant)).rejects.toThrow(/inside a transaction/);
    await expect(assertInternalUserSeatsWithinLimit(db, tenant)).rejects.toThrow(/inside a transaction/);
  });

  it('two tenants do not block each other', async () => {
    const a = await seedTenant({ limit: 5 });
    const b = await seedTenant({ limit: 5 });
    const holder = await db.transaction();
    try {
      await lockInternalUserSeats(holder, a);
      const bResult = await Promise.race([
        db.transaction((trx) => checkInternalUserLicenseLimit(trx, b)),
        new Promise((_, rej) => setTimeout(() => rej(new Error('tenant B blocked by tenant A lock')), 5_000)),
      ]);
      expect(bResult).toEqual({ ok: true });

      // Sanity: the same tenant IS blocked while the lock is held.
      const sameTenant = db.transaction((trx) => checkInternalUserLicenseLimit(trx, a));
      await waitForBlockedBackends(1);
      await holder.commit();
      expect(await sameTenant).toEqual({ ok: true });
    } finally {
      if (!holder.isCompleted()) await holder.rollback();
    }
  });

  it('tripwire fires and rolls back when the post-insert count is over the limit', async () => {
    const tenant = await seedTenant({ limit: 2 });
    await seedUser(tenant, 'a@example.test');
    await seedUser(tenant, 'b@example.test');
    await expect(db.transaction(async (trx) => {
      await trx('users').insert({
        tenant, user_id: randomUUID(), username: 'c@example.test', email: 'c@example.test',
        first_name: 'T', last_name: 'U', user_type: 'internal', hashed_password: 'unused', is_inactive: false,
      }); // simulates a writer that skipped the guard: 3 > 2
      await assertInternalUserSeatsWithinLimit(trx, tenant);
    })).rejects.toMatchObject({ name: 'InternalUserSeatOverflowError', code: 'LICENSE_LIMIT_REACHED' });
    expect(await activeInternal(tenant)).toBe(2);

    // Within the limit, the tripwire is silent.
    await db.transaction(async (trx) => {
      await trx('users').where({ tenant, email: 'b@example.test' }).update({ is_inactive: true });
      await trx('users').insert({
        tenant, user_id: randomUUID(), username: 'd@example.test', email: 'd@example.test',
        first_name: 'T', last_name: 'U', user_type: 'internal', hashed_password: 'unused', is_inactive: false,
      });
      await assertInternalUserSeatsWithinLimit(trx, tenant);
    });
  });
});
