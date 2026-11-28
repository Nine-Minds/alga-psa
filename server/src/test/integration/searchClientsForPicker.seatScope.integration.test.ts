/**
 * Add Ticket client picker, co-managed seat scope (alga-2026-0003426).
 *
 * A seat technician is an internal user of the sponsor tenant. Their arrangement names the one client they may see,
 * and that boundary must hold in the picker whether or not the tenant has ever published a policy bundle: search
 * rows, `total`, paging and lookup of a selected id all come from the scoped SQL. Both picker entry points are
 * driven: the tickets package action QuickAddTicket calls, and the clients package equivalent.
 *
 * Real kernel, real bundle service, real seat resolver on migrated PostgreSQL. Only the session seam (withAuth),
 * the DB handle and the coarse RBAC grant are stood in for.
 *
 * Fixture: an eligible hosted sponsor. Hosted entitlements require the sponsor tenant to be on the Pro plan
 * (`tenants.plan = 'pro'`, product `psa`); `createTenant` seeds that, and it is asserted below so a fixture that
 * silently lacks Pro fails loudly instead of stalling before its assertions.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { randomUUID } from 'node:crypto';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { createClient, createTenant, createUser } from '../../../test-utils/testDataFactory';

const ref = vi.hoisted(() => ({ knex: null as Knex | null, tenant: '', userId: '' }));

vi.mock('@alga-psa/auth', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  withAuth: (fn: any) => (...args: any[]) =>
    fn({ user_id: ref.userId, tenant: ref.tenant, user_type: 'internal', roles: [] }, { tenant: ref.tenant }, ...args),
  hasPermission: vi.fn(async () => true),
  ...(await import('../../../test-utils/rbacStandIn')).rbacStandIn(vi.fn(async () => true)),
}));
vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db')>()),
  createTenantKnex: async () => ({ knex: ref.knex, tenant: ref.tenant }),
  getConnection: async () => ref.knex,
}));
vi.mock('@alga-psa/formatting/avatarUtils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/formatting/avatarUtils')>()),
  getClientLogoUrlsBatch: vi.fn(async (ids: string[]) => new Map(ids.map((id) => [id, null]))),
}));

import { createCoManagedSeatArrangement } from '@alga-psa/co-managed';
import { CO_MANAGED_SEAT_RESOLVER_ID, coManagedSeatResolver } from '@alga-psa/co-managed/seatAuthority';
import { registerBuiltinRuleResolver } from '@alga-psa/authorization/kernel';
import { retainBuiltinResolverSubject } from '@alga-psa/authorization/subject';
import {
  createAuthorizationBundle,
  createBundleAssignment,
  publishBundleRevision,
  upsertBundleRule,
} from '@alga-psa/authorization/bundles/service';
import { searchClientsForPicker as searchFromClients } from '@alga-psa/clients/actions/clientPickerActions';
import { searchClientsForPicker as searchFromTickets } from '@alga-psa/tickets/actions/clientLookupActions';
import { getClientById, getAllClients } from '@alga-psa/clients/actions/queryActions';

const DAY = 86_400_000;
const HOOK_TIMEOUT = 600_000;

// Both entry points must agree on every question asked of them.
const entryPoints = [
  ['tickets package searchClientsForPicker (Add Ticket)', searchFromTickets],
  ['clients package searchClientsForPicker', searchFromClients],
] as const;

describe('seat technician client picker scope (real kernel, real DB)', { shuffle: false }, () => {
  let db: Knex;
  let sponsor: string;
  const clients = { seat: '', other: '', third: '' };
  const users = { seat: '', staff: '', admin: '', narrowed: '', noRule: '', unrelated: '' };
  let arrangementId: string;

  const asUser = (userId: string) => { ref.userId = userId; };
  const idsOf = (r: { clients: { client_id: string }[] }) => r.clients.map((c) => c.client_id).sort();

  const insertSeatAssignment = async (userId: string, arrangement: string) => {
    await db.transaction(async (trx) => {
      await retainBuiltinResolverSubject(trx, { tenant: sponsor, userId }, CO_MANAGED_SEAT_RESOLVER_ID);
      await trx('co_managed_seat_assignments').insert({
        tenant: sponsor, assignment_id: randomUUID(), arrangement_id: arrangement, user_id: userId, state: 'active',
      });
    });
  };

  /** A published bundle with the given rules, assigned to one user. */
  const assignBundle = async (
    userId: string,
    rules: Array<{ resourceType: string; templateKey: string; config: Record<string, unknown> }>
  ) => {
    const bundle = await createAuthorizationBundle(db, { tenant: sponsor, name: `bundle-${randomUUID().slice(0, 8)}`, actorUserId: users.admin });
    for (const rule of rules) {
      await upsertBundleRule(db, {
        tenant: sponsor, bundleId: bundle.bundleId, revisionId: bundle.revisionId,
        resourceType: rule.resourceType, action: 'read', templateKey: rule.templateKey as any,
        config: rule.config as any, actorUserId: users.admin,
      });
    }
    await publishBundleRevision(db as any, { tenant: sponsor, bundleId: bundle.bundleId, revisionId: bundle.revisionId, actorUserId: users.admin });
    await createBundleAssignment(db, { tenant: sponsor, bundleId: bundle.bundleId, targetType: 'user', targetId: userId, actorUserId: users.admin });
  };

  beforeAll(async () => {
    db = await createTestDbConnection({ databaseName: `seat_picker_scope_${randomUUID().replaceAll('-', '').slice(0, 20)}` });
    ref.knex = db;
    registerBuiltinRuleResolver(coManagedSeatResolver);

    // An eligible hosted sponsor: psa product on the Pro plan, with a verified hosted entitlement.
    sponsor = await createTenant(db, `Seat picker sponsor ${randomUUID().slice(0, 8)}`, { productCode: 'psa' });
    expect(await db('tenants').where({ tenant: sponsor }).first('plan', 'product_code')).toMatchObject({ plan: 'pro', product_code: 'psa' });
    ref.tenant = sponsor;
    await db('co_managed_entitlements').insert({
      tenant: sponsor, source: 'hosted', source_reference: `sub_${randomUUID()}`, capacity: 10,
      verified_at: new Date(Date.now() - 400 * DAY), valid_until: new Date(Date.now() + 365 * DAY),
    });

    clients.seat = await createClient(db, sponsor, 'Seat Client Inc');
    clients.other = await createClient(db, sponsor, 'Other Client LLC');
    clients.third = await createClient(db, sponsor, 'Third Client Ltd');

    const arrangement = await createCoManagedSeatArrangement(db, {
      sponsorTenant: sponsor, clientId: clients.seat, operationId: randomUUID(), seats: 5,
    });
    arrangementId = arrangement.arrangement_id;

    users.admin = await createUser(db, sponsor, { user_type: 'internal' });
    users.staff = await createUser(db, sponsor, { user_type: 'internal' });
    for (const key of ['seat', 'narrowed', 'noRule', 'unrelated'] as const) {
      users[key] = await createUser(db, sponsor, { user_type: 'internal' });
      await insertSeatAssignment(users[key], arrangementId);
    }
  }, HOOK_TIMEOUT);

  afterAll(async () => { await db?.destroy(); }, HOOK_TIMEOUT);

  // T001: a live seat and zero bundles.
  describe.each(entryPoints)('%s: live seat, no bundles configured', (_label, search) => {
    it('lists only the arrangement client, with total, paging and search scoped', async () => {
      // The tenant genuinely has no published bundle assignment at this point.
      expect(await db('authorization_bundle_assignments').where({ tenant: sponsor }).count({ n: '*' }).first()).toMatchObject({ n: '0' });

      asUser(users.seat);
      const first = await search({ status: 'all' });
      expect(idsOf(first)).toEqual([clients.seat]);
      expect(first.total).toBe(1);

      // Paging past the single in-scope row yields nothing, and a page of one still reports the scoped total.
      const paged = await search({ status: 'all', pageSize: 1, page: 1 });
      expect(paged.clients).toEqual([]);
      expect(paged.total).toBe(1);

      // Searching for an out-of-scope client's name contributes no rows and no count.
      const hit = await search({ search: 'Other Client', status: 'all' });
      expect(hit.clients).toEqual([]);
      expect(hit.total).toBe(0);
    }, HOOK_TIMEOUT);

    it('resolves a mixed list of selected ids to the in-scope client only', async () => {
      asUser(users.seat);
      const lookup = await search({ ids: [clients.other, clients.seat, clients.third] });
      expect(idsOf(lookup)).toEqual([clients.seat]);
      expect(lookup.total).toBe(1);

      const outOnly = await search({ ids: [clients.other] });
      expect(outOnly.clients).toEqual([]);
      expect(outOnly.total).toBe(0);
    }, HOOK_TIMEOUT);

    it('leaves ordinary MSP staff with every client in the tenant', async () => {
      asUser(users.staff);
      const all = await search({ status: 'all' });
      expect(idsOf(all)).toEqual([clients.seat, clients.other, clients.third].sort());
      expect(all.total).toBe(3);
      expect(idsOf(await search({ ids: [clients.other, clients.seat] }))).toEqual([clients.seat, clients.other].sort());
    }, HOOK_TIMEOUT);
  });

  it('applies the seat boundary to the shared client reads too (list and detail agree)', async () => {
    asUser(users.seat);
    expect((await getAllClients()).map((c: any) => c.client_id)).toEqual([clients.seat]);
    expect((await getClientById(clients.seat))?.client_id).toBe(clients.seat);
    expect(await getClientById(clients.other)).toBeNull();
    asUser(users.staff);
    expect(await getClientById(clients.other)).not.toBeNull();
  }, HOOK_TIMEOUT);

  // T002: bundles can only narrow the seat further.
  describe('with bundles assigned', () => {
    beforeAll(async () => {
      // 1. narrowing: a client read rule naming the seat client and another one the seat does not have.
      await assignBundle(users.narrowed, [
        { resourceType: 'client', templateKey: 'selected_clients', config: { selectedClientIds: [clients.other, clients.third] } },
      ]);
      // 2. a bundle with no client read rule at all (a ticket rule) leaves the seat boundary alone.
      await assignBundle(users.noRule, [
        { resourceType: 'ticket', templateKey: 'same_client', config: {} },
      ]);
      // 3. an unrelated assignment: a bundle assigned to somebody else.
      await assignBundle(users.staff, [
        { resourceType: 'client', templateKey: 'selected_clients', config: { selectedClientIds: [clients.third] } },
      ]);
    }, HOOK_TIMEOUT);

    describe.each(entryPoints)('%s', (_label, search) => {
      it('a client read rule selecting other clients gives an empty intersection with the seat', async () => {
        asUser(users.narrowed);
        const r = await search({ status: 'all' });
        expect(r.clients).toEqual([]);
        expect(r.total).toBe(0);
        expect((await search({ ids: [clients.seat, clients.other, clients.third] })).clients).toEqual([]);
      }, HOOK_TIMEOUT);

      it('a bundle with no client read rule leaves the seat boundary intact', async () => {
        asUser(users.noRule);
        const r = await search({ status: 'all' });
        expect(idsOf(r)).toEqual([clients.seat]);
        expect(r.total).toBe(1);
        expect((await search({ ids: [clients.other] })).clients).toEqual([]);
      }, HOOK_TIMEOUT);

      it('a bundle assigned to someone else changes nothing for the seat technician', async () => {
        asUser(users.unrelated);
        expect(idsOf(await search({ status: 'all' }))).toEqual([clients.seat]);
      }, HOOK_TIMEOUT);

      it('a narrowing bundle on ordinary staff still applies to them alone', async () => {
        asUser(users.staff);
        expect(idsOf(await search({ status: 'all' }))).toEqual([clients.third]);
      }, HOOK_TIMEOUT);
    });

    it('a rule that names the seat client and a bundle that names it too keeps exactly that client', async () => {
      const both = await createUser(db, sponsor, { user_type: 'internal' });
      await insertSeatAssignment(both, arrangementId);
      await assignBundle(both, [
        { resourceType: 'client', templateKey: 'selected_clients', config: { selectedClientIds: [clients.seat, clients.other] } },
      ]);
      asUser(both);
      for (const [, search] of entryPoints) {
        const r = await search({ status: 'all' });
        expect(idsOf(r)).toEqual([clients.seat]);
        expect(r.total).toBe(1);
      }
    }, HOOK_TIMEOUT);
  });

  // T003: assignment state is read on every request.
  it('a revoked seat gets empty results on its very next request; staff are unaffected', async () => {
    const tech = await createUser(db, sponsor, { user_type: 'internal' });
    await insertSeatAssignment(tech, arrangementId);

    for (const [, search] of entryPoints) {
      asUser(tech);
      expect(idsOf(await search({ status: 'all' }))).toEqual([clients.seat]);
    }

    await db('co_managed_seat_assignments').where({ tenant: sponsor, user_id: tech }).update({ state: 'revoked', revoked_at: new Date() });

    for (const [, search] of entryPoints) {
      asUser(tech);
      const after = await search({ status: 'all' });
      expect(after.clients).toEqual([]);
      expect(after.total).toBe(0);
      expect((await search({ ids: [clients.seat] })).clients).toEqual([]);
    }
  }, HOOK_TIMEOUT);
});
