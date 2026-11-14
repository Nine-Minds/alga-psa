/**
 * Co-managed seat principal kind, slice S12 (F029, F030) on real Postgres.
 *
 * The kind is read from the same rows as the seat authority, on every request. An ordinary MSP user costs
 * no statement beyond the one that already read their tenant or key owner; a seat technician pays one more.
 * A revoked technician stays in the kind. A change decides the next request, so nothing here is cached.
 */
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createCoManagedSeatArrangement } from '@alga-psa/co-managed';
import { CO_MANAGED_SEAT_RESOLVER_ID, coManagedSeatResolver } from '@alga-psa/co-managed/seatAuthority';
import { registerBuiltinRuleResolver, unregisterBuiltinRuleResolver } from '@alga-psa/authorization/kernel';
import { retainBuiltinResolverSubject } from '@alga-psa/authorization/subject';
import { mayHoldApiCredentials, principalMemberColumns, resolvePrincipalKind } from '@alga-psa/authorization/subject/principalKind';
import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { describeWithDb } from '../../../test-utils/requireDb';
import { createClient, createTenant, createUser } from '../../../test-utils/testDataFactory';

const DAY = 86_400_000;
const describeDb = await describeWithDb();

describeDb('the seat principal kind is derived from rows on every request', { shuffle: false }, () => {
  let db: Knex;

  const sponsor = async () => {
    const tenant = await createTenant(db, `Seat sponsor ${randomUUID().slice(0, 8)}`, { productCode: 'psa' });
    await db('co_managed_entitlements').insert({ tenant, source: 'hosted', source_reference: `sub_${randomUUID()}`, capacity: 5,
      verified_at: new Date(Date.now() - 400 * DAY), valid_until: new Date(Date.now() + 365 * DAY) });
    return tenant;
  };
  const technician = async (tenant: string, state: 'active' | 'revoked' = 'active') => {
    const clientId = await createClient(db, tenant, `Seat client ${randomUUID().slice(0, 8)}`);
    const arrangement = await createCoManagedSeatArrangement(db, { sponsorTenant: tenant, clientId, operationId: randomUUID(), seats: 1 });
    const userId = await createUser(db, tenant, { user_type: 'internal' });
    await db.transaction(async (trx) => {
      await retainBuiltinResolverSubject(trx, { tenant, userId }, CO_MANAGED_SEAT_RESOLVER_ID);
      await trx('co_managed_seat_assignments').insert({ tenant, assignment_id: randomUUID(), arrangement_id: arrangement.arrangement_id,
        user_id: userId, state, ...(state === 'revoked' ? { revoked_at: new Date() } : {}) });
    });
    return { userId, arrangementId: arrangement.arrangement_id };
  };

  /** What a caller does: read the tenant row with the user's membership folded in, then ask. */
  const request = async (tenant: string, userId: string) => {
    const statements: string[] = [];
    const record = (query: { sql: string }) => statements.push(query.sql);
    db.on('query', record);
    try {
      const row = await tenantDb(db, tenant).table('tenants').select('product_code', ...principalMemberColumns(db, { tenant, userId })).first();
      const kind = await resolvePrincipalKind(db, { tenant, userId, member: row?.principal_member });
      return { row, kind, statements: statements.length };
    } finally {
      db.off('query', record);
    }
  };

  beforeAll(async () => {
    db = await createTestDbConnection({ databaseName: 's12_seat_principal_test' });
    registerBuiltinRuleResolver(coManagedSeatResolver);
  }, 300_000);
  afterAll(async () => {
    unregisterBuiltinRuleResolver(CO_MANAGED_SEAT_RESOLVER_ID);
    await db?.destroy();
  });

  // F029
  it('derives the seat kind for a technician, and none for MSP staff, with no statement more for MSP staff', async () => {
    const tenant = await sponsor();
    const seat = await technician(tenant);
    const staff = await createUser(db, tenant, { user_type: 'internal' });

    const staffRequest = await request(tenant, staff);
    expect(staffRequest.kind).toBeNull();
    expect(staffRequest.row?.principal_member).toBe(false);
    expect(staffRequest.statements).toBe(1); // the tenant read itself: membership rode along

    const seatRequest = await request(tenant, seat.userId);
    expect(seatRequest.kind).toMatchObject({ kind: 'co_managed_seat', apiCredentials: 'refused' });
    expect(seatRequest.statements).toBe(2); // the tenant read, then the facts
  });

  // F029 / F030
  it('keeps a revoked technician in the kind, so revocation closes the surface instead of opening the MSP one', async () => {
    const tenant = await sponsor();
    const seat = await technician(tenant, 'revoked');
    expect((await request(tenant, seat.userId)).kind).toMatchObject({ kind: 'co_managed_seat' });
    await expect(mayHoldApiCredentials(db, { tenant, userId: seat.userId })).resolves.toBe(false);
  });

  // F030
  it('refuses API credentials to a seat technician and grants them to MSP staff, with or without the probe', async () => {
    const tenant = await sponsor();
    const seat = await technician(tenant);
    const staff = await createUser(db, tenant, { user_type: 'internal' });

    await expect(mayHoldApiCredentials(db, { tenant, userId: seat.userId })).resolves.toBe(false);
    await expect(mayHoldApiCredentials(db, { tenant, userId: staff })).resolves.toBe(true);
    await expect(mayHoldApiCredentials(db, { tenant, userId: staff, member: false })).resolves.toBe(true);
  });

  // F027 shape: nothing is cached across requests
  it('decides the next request after the user becomes a technician', async () => {
    const tenant = await sponsor();
    const user = await createUser(db, tenant, { user_type: 'internal' });
    expect((await request(tenant, user)).kind).toBeNull();

    const clientId = await createClient(db, tenant, `Seat client ${randomUUID().slice(0, 8)}`);
    const arrangement = await createCoManagedSeatArrangement(db, { sponsorTenant: tenant, clientId, operationId: randomUUID(), seats: 1 });
    await db.transaction(async (trx) => {
      await retainBuiltinResolverSubject(trx, { tenant, userId: user }, CO_MANAGED_SEAT_RESOLVER_ID);
      await trx('co_managed_seat_assignments').insert({ tenant, assignment_id: randomUUID(), arrangement_id: arrangement.arrangement_id,
        user_id: user, state: 'active' });
    });

    expect((await request(tenant, user)).kind).toMatchObject({ kind: 'co_managed_seat' });
    await expect(mayHoldApiCredentials(db, { tenant, userId: user })).resolves.toBe(false);
  });
});
