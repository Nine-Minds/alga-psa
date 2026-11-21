/**
 * Co-managed seat slice S38: the end-arrangement actions honour the administrator's client scope.
 *
 * An arrangement belongs to one client. Its preview names that client and counts its tickets, and
 * ending it hands that client's tickets back. An administrator whose published bundle limits client
 * reads to other clients gets the answer a missing arrangement gets (`not_found`) from both actions,
 * and nothing is ended; an administrator with no client restriction previews and ends it.
 *
 * Real DB, real kernel and bundle resolution; only the session (withAuth), the DB handle, the coarse
 * RBAC grant and the release capability are stood in for.
 */
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createCoManagedSeatArrangement } from '@alga-psa/co-managed';
import {
  createAuthorizationBundle, createBundleAssignment, publishBundleRevision, upsertBundleRule,
} from '@alga-psa/authorization/bundles/service';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { describeWithDb } from '../../../test-utils/requireDb';
import { createClient, createTenant, createUser } from '../../../test-utils/testDataFactory';

const ref = vi.hoisted(() => ({ knex: null as Knex | null, tenant: '', user: null as any }));

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db')>()),
  createTenantKnex: vi.fn(async () => ({ knex: ref.knex, tenant: ref.tenant })),
}));
vi.mock('@alga-psa/auth', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  withAuth: (action: any) => (...args: any[]) => action(ref.user, { tenant: ref.tenant }, ...args),
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: vi.fn(async () => true) }));
vi.mock('@alga-psa/core/capability/server', () => ({ requireCapabilityForAction: async () => undefined }));

import {
  endCoManagedSeatArrangementAction, getCoManagedSeatArrangementEndPreview,
} from '@/lib/actions/coManagedSeatActions';

const DAY = 86_400_000;
const describeDb = await describeWithDb();

describeDb('ending a seat arrangement respects the administrator client scope', { shuffle: false }, () => {
  let db: Knex;
  let arrangementId = '';
  let clientName = '';
  const users = { owner: '', narrowed: '', unrestricted: '' };

  const as = async (userId: string) => {
    ref.user = await db('users').where({ tenant: ref.tenant, user_id: userId }).first();
  };
  const arrangementState = async () => (await db('co_managed_seat_arrangements')
    .where({ tenant: ref.tenant, arrangement_id: arrangementId }).first('state'))?.state;

  beforeAll(async () => {
    db = await createTestDbConnection({ databaseName: 's38_end_arrangement_client_scope_test' });
    ref.knex = db;
    const sponsor = await createTenant(db, `Scope sponsor ${randomUUID().slice(0, 8)}`, { productCode: 'psa' });
    ref.tenant = sponsor;
    await db('co_managed_entitlements').insert({ tenant: sponsor, source: 'hosted', source_reference: `sub_${randomUUID()}`, capacity: 10,
      verified_at: new Date(Date.now() - 400 * DAY), valid_until: new Date(Date.now() + 365 * DAY) });
    clientName = `Arranged client ${randomUUID().slice(0, 8)}`;
    const arrangedClient = await createClient(db, sponsor, clientName);
    const otherClient = await createClient(db, sponsor, `Other client ${randomUUID().slice(0, 8)}`);
    arrangementId = (await createCoManagedSeatArrangement(db, { sponsorTenant: sponsor, clientId: arrangedClient, operationId: randomUUID(), seats: 2 })).arrangement_id;

    users.owner = await createUser(db, sponsor, { user_type: 'internal' });
    users.narrowed = await createUser(db, sponsor, { user_type: 'internal' });
    users.unrestricted = await createUser(db, sponsor, { user_type: 'internal' });

    // The narrowed administrator may read only the other client.
    const bundle = await createAuthorizationBundle(db, { tenant: sponsor, name: `other-client-${arrangementId.slice(0, 8)}`, actorUserId: users.owner });
    await upsertBundleRule(db, { tenant: sponsor, bundleId: bundle.bundleId, revisionId: bundle.revisionId, resourceType: 'client', action: 'read',
      templateKey: 'selected_clients', config: { selectedClientIds: [otherClient] }, actorUserId: users.owner });
    await publishBundleRevision(db as any, { tenant: sponsor, bundleId: bundle.bundleId, revisionId: bundle.revisionId, actorUserId: users.owner });
    await createBundleAssignment(db, { tenant: sponsor, bundleId: bundle.bundleId, targetType: 'user', targetId: users.narrowed, actorUserId: users.owner });
  }, 300_000);
  afterAll(async () => { await db?.destroy(); });

  it('an administrator outside the client scope gets not_found from the preview and the end, and nothing ends', async () => {
    await as(users.narrowed);
    expect(await getCoManagedSeatArrangementEndPreview({ arrangementId })).toEqual({ ok: false, reason: 'not_found' });
    expect(await endCoManagedSeatArrangementAction({ arrangementId })).toEqual({ ok: false, reason: 'not_found' });
    expect(await arrangementState()).toBe('active');
  });

  it('an unknown or malformed arrangement id is not_found', async () => {
    await as(users.unrestricted);
    expect(await getCoManagedSeatArrangementEndPreview({ arrangementId: randomUUID() })).toEqual({ ok: false, reason: 'not_found' });
    expect(await endCoManagedSeatArrangementAction({ arrangementId: 'not-a-uuid' })).toEqual({ ok: false, reason: 'not_found' });
  });

  it('an administrator with the client in scope previews and ends the arrangement', async () => {
    await as(users.unrestricted);
    const preview = await getCoManagedSeatArrangementEndPreview({ arrangementId });
    expect(preview).toMatchObject({ ok: true, preview: { arrangementId, clientName, state: 'active', seatsToRelease: 2 } });
    const ended = await endCoManagedSeatArrangementAction({ arrangementId });
    expect(ended).toMatchObject({ ok: true, result: { arrangementId, ended: true, releasedSeats: 2 } });
    expect(await arrangementState()).toBe('ended');
  });
});
