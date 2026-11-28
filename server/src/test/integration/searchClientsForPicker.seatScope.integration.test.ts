/**
 * Co-managed seat scope in the Add Ticket client picker (alga-2026-0003426).
 *
 * A seat technician is an internal user of the sponsor tenant. Their arrangement names the one client they may
 * see, and that boundary must hold in both picker actions (rows, totals, search hits, selected-id lookups) and in
 * the contact reads, whether the tenant has no policy bundles, unrelated ones, or applicable ones. Bundles can
 * narrow a seat further but never widen it. Real kernel, real bundle service, real seat resolver, migrated
 * PostgreSQL; only the session seam (withAuth), the DB handle and the coarse RBAC grant are stood in for.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { randomUUID } from 'node:crypto';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { createClient, createTenant, createUser } from '../../../test-utils/testDataFactory';
import { createCoManagedSeatArrangement } from '@alga-psa/co-managed';
import { CO_MANAGED_SEAT_RESOLVER_ID, coManagedSeatResolver } from '@alga-psa/co-managed/seatAuthority';
import { registerBuiltinRuleResolver } from '@alga-psa/authorization/kernel';
import { retainBuiltinResolverSubject } from '@alga-psa/authorization/subject';
import {
  createAuthorizationBundle,
  createBundleAssignment,
  publishBundleRevision,
  setBundleRevisionBaseline,
  upsertBundleRule,
} from '@alga-psa/authorization/bundles/service';

const ref = vi.hoisted(() => ({ knex: null as Knex | null, tenant: '', user: null as any }));

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db')>()),
  createTenantKnex: vi.fn(async () => ({ knex: ref.knex, tenant: ref.tenant })),
  getConnection: vi.fn(async () => ref.knex),
}));

vi.mock('@alga-psa/auth', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  withAuth: (action: any) => (...args: any[]) => action(ref.user, { tenant: ref.tenant }, ...args),
  ...(await import('../../../test-utils/rbacStandIn')).rbacStandIn(vi.fn(async () => true)),
}));

vi.mock('@alga-psa/event-bus/publishers', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  publishEvent: vi.fn(),
  publishWorkflowEvent: vi.fn(),
  publishStoredWorkflowEvent: vi.fn(),
}));

import { searchClientsForPicker as pickerFromClients } from '../../../../packages/clients/src/actions/clientPickerActions';
import { searchClientsForPicker as pickerFromTickets } from '../../../../packages/tickets/src/actions/clientLookupActions';
import { getAllContacts, searchContactListIds } from '../../../../packages/clients/src/actions/queryActions';
import { getContactByContactNameId } from '../../../../packages/clients/src/actions/contact-actions/contactActions';

const HOOK_TIMEOUT = 900_000;
const DAY = 86_400_000;

interface Fixture {
  tenant: string;
  mark: string;
  seatClient: string;
  otherClient: string;
  thirdClient: string;
  seatContact: string;
  otherContact: string;
  arrangementId: string;
  techId: string;
  staffId: string;
  adminId: string;
}

describe('seat technician client picker scope (real kernel, real DB)', { shuffle: false }, () => {
  let db: Knex;

  const pickers = [
    ['clients package', pickerFromClients],
    ['tickets package (Add Ticket)', pickerFromTickets],
  ] as const;

  const asUser = (tenant: string, userId: string) => {
    ref.tenant = tenant;
    ref.user = { user_id: userId, user_type: 'internal', tenant, roles: [], email: `${userId}@example.com` };
  };

  /** A hosted Pro sponsor with three clients, one seat arrangement for the first, one live technician and one staff user. */
  async function fixture(): Promise<Fixture> {
    const mark = randomUUID().slice(0, 8);
    const tenant = await createTenant(db, `Seat picker ${mark}`, { productCode: 'psa' });
    await db('co_managed_entitlements').insert({
      tenant, source: 'hosted', source_reference: `sub_${randomUUID()}`, capacity: 5,
      verified_at: new Date(Date.now() - 400 * DAY), valid_until: new Date(Date.now() + 365 * DAY),
    });
    const seatClient = await createClient(db, tenant, `Alpha ${mark}`);
    const otherClient = await createClient(db, tenant, `Bravo ${mark}`);
    const thirdClient = await createClient(db, tenant, `Charlie ${mark}`);
    const seatContact = randomUUID();
    const otherContact = randomUUID();
    for (const [id, name, clientId] of [[seatContact, `Ann Alpha ${mark}`, seatClient], [otherContact, `Bob Bravo ${mark}`, otherClient]]) {
      await db('contacts').insert({ tenant, contact_name_id: id, full_name: name, client_id: clientId, email: `${id}@example.com`, is_inactive: false });
    }
    const arrangement = await createCoManagedSeatArrangement(db, { sponsorTenant: tenant, clientId: seatClient, operationId: randomUUID(), seats: 2 });
    const techId = await createUser(db, tenant, { user_type: 'internal' });
    await db.transaction(async (trx) => {
      await retainBuiltinResolverSubject(trx, { tenant, userId: techId }, CO_MANAGED_SEAT_RESOLVER_ID);
      await trx('co_managed_seat_assignments').insert({
        tenant, assignment_id: randomUUID(), arrangement_id: arrangement.arrangement_id, user_id: techId, state: 'active',
      });
    });
    const staffId = await createUser(db, tenant, { user_type: 'internal' });
    const adminId = await createUser(db, tenant, { user_type: 'internal' });
    return {
      tenant, mark, seatClient, otherClient, thirdClient, seatContact, otherContact,
      arrangementId: arrangement.arrangement_id, techId, staffId, adminId,
    };
  }

  async function bundle(
    f: Fixture,
    opts: { rules: Array<{ resourceType: string; clientIds: string[] }>; assignTo: string; baseline?: 'open' | 'closed' }
  ) {
    const created = await createAuthorizationBundle(db, { tenant: f.tenant, name: `b-${randomUUID().slice(0, 8)}`, actorUserId: f.adminId });
    if (opts.baseline) {
      await setBundleRevisionBaseline(db, { tenant: f.tenant, bundleId: created.bundleId, revisionId: created.revisionId, baseline: opts.baseline, actorUserId: f.adminId });
    }
    for (const rule of opts.rules) {
      await upsertBundleRule(db, {
        tenant: f.tenant, bundleId: created.bundleId, revisionId: created.revisionId,
        resourceType: rule.resourceType, action: 'read', templateKey: 'selected_clients',
        config: { selectedClientIds: rule.clientIds }, actorUserId: f.adminId,
      });
    }
    await publishBundleRevision(db as any, { tenant: f.tenant, bundleId: created.bundleId, revisionId: created.revisionId, actorUserId: f.adminId });
    await createBundleAssignment(db, { tenant: f.tenant, bundleId: created.bundleId, targetType: 'user', targetId: opts.assignTo, actorUserId: f.adminId });
  }

  /** Every way the picker is used: first page, search for each client, selected-id lookup with mixed ids. */
  async function expectOnly(picker: typeof pickerFromClients, f: Fixture, visible: string[]) {
    const page = await picker({ status: 'all' } as any);
    expect(page.clients.map((c) => c.client_id).sort()).toEqual([...visible].sort());
    expect(page.total).toBe(visible.length);

    for (const [id, name] of [[f.seatClient, 'Alpha'], [f.otherClient, 'Bravo'], [f.thirdClient, 'Charlie']]) {
      const hit = await picker({ search: `${name} ${f.mark}`, status: 'all' } as any);
      const expected = visible.includes(id) ? [id] : [];
      expect(hit.clients.map((c) => c.client_id)).toEqual(expected);
      expect(hit.total).toBe(expected.length);
    }

    const lookup = await picker({ ids: [f.seatClient, f.otherClient, f.thirdClient] } as any);
    const wanted = [f.seatClient, f.otherClient, f.thirdClient].filter((id) => visible.includes(id));
    expect(lookup.clients.map((c) => c.client_id).sort()).toEqual([...wanted].sort());
    expect(lookup.total).toBe(wanted.length);
  }

  beforeAll(async () => {
    db = await createTestDbConnection({ databaseName: 'seat_scope_picker_test' });
    ref.knex = db;
    registerBuiltinRuleResolver(coManagedSeatResolver);
  }, HOOK_TIMEOUT);

  afterAll(async () => { await db?.destroy(); }, HOOK_TIMEOUT);

  describe.each(pickers)('%s', (_label, picker) => {
    it('T001: a live seat with zero bundles sees only its arrangement client in rows, total, search and id lookup', async () => {
      const f = await fixture();
      asUser(f.tenant, f.techId);
      await expectOnly(picker, f, [f.seatClient]);
    }, HOOK_TIMEOUT);

    it('T002: an unrelated assignment leaves the seat boundary intact', async () => {
      const f = await fixture();
      // A bundle that exists in the tenant but is assigned to someone else.
      await bundle(f, { rules: [{ resourceType: 'client', clientIds: [f.seatClient, f.otherClient] }], assignTo: f.staffId });
      asUser(f.tenant, f.techId);
      await expectOnly(picker, f, [f.seatClient]);
    }, HOOK_TIMEOUT);

    it('T002: an applicable bundle with no client read rule leaves the seat boundary intact', async () => {
      const f = await fixture();
      await bundle(f, { rules: [{ resourceType: 'ticket', clientIds: [f.seatClient, f.otherClient] }], assignTo: f.techId });
      asUser(f.tenant, f.techId);
      await expectOnly(picker, f, [f.seatClient]);
    }, HOOK_TIMEOUT);

    it('T002: a bundle can narrow the seat but never widen it', async () => {
      const f = await fixture();
      await bundle(f, { rules: [{ resourceType: 'client', clientIds: [f.seatClient, f.otherClient] }], assignTo: f.techId });
      asUser(f.tenant, f.techId);
      await expectOnly(picker, f, [f.seatClient]);
    }, HOOK_TIMEOUT);

    it('T002: a client read rule selecting a different client gives an empty intersection', async () => {
      const f = await fixture();
      await bundle(f, { rules: [{ resourceType: 'client', clientIds: [f.otherClient] }], assignTo: f.techId });
      asUser(f.tenant, f.techId);
      await expectOnly(picker, f, []);
    }, HOOK_TIMEOUT);

    it('T003: after revocation a fresh request returns no clients', async () => {
      const f = await fixture();
      asUser(f.tenant, f.techId);
      await expectOnly(picker, f, [f.seatClient]);
      await db('co_managed_seat_assignments')
        .where({ tenant: f.tenant, user_id: f.techId })
        .update({ state: 'revoked', revoked_at: new Date(), updated_at: new Date() });
      await expectOnly(picker, f, []);
    }, HOOK_TIMEOUT);

    it('T003: ordinary unrestricted staff in the same tenant still see every client', async () => {
      const f = await fixture();
      asUser(f.tenant, f.staffId);
      await expectOnly(picker, f, [f.seatClient, f.otherClient, f.thirdClient]);
    }, HOOK_TIMEOUT);

    it('a closed bundle that names neither client nor contact read now denies (kernel closed-baseline semantics)', async () => {
      const f = await fixture();
      await bundle(f, {
        rules: [{ resourceType: 'ticket', clientIds: [f.seatClient] }], assignTo: f.staffId, baseline: 'closed',
      });
      asUser(f.tenant, f.staffId);
      await expectOnly(picker, f, []);
      // A user without the bundle is unaffected.
      asUser(f.tenant, f.adminId);
      await expectOnly(picker, f, [f.seatClient, f.otherClient, f.thirdClient]);
    }, HOOK_TIMEOUT);
  });

  describe('seat contact reads (list and detail agree)', () => {
    it('lists, searches and fetches only the contact of the arrangement client, with zero bundles', async () => {
      const f = await fixture();
      asUser(f.tenant, f.techId);
      const all = await getAllContacts('all');
      expect(all.map((c: any) => c.contact_name_id)).toEqual([f.seatContact]);
      expect([...(await searchContactListIds(f.mark))]).toEqual([f.seatContact]);
      expect((await getContactByContactNameId(f.seatContact))?.contact_name_id).toBe(f.seatContact);
      expect(await getContactByContactNameId(f.otherContact)).toBeNull();
    }, HOOK_TIMEOUT);

    it('staff in the same tenant see both contacts; a revoked seat sees none', async () => {
      const f = await fixture();
      asUser(f.tenant, f.staffId);
      expect((await getAllContacts('all')).map((c: any) => c.contact_name_id).sort()).toEqual([f.seatContact, f.otherContact].sort());
      expect((await getContactByContactNameId(f.otherContact))?.contact_name_id).toBe(f.otherContact);

      await db('co_managed_seat_assignments')
        .where({ tenant: f.tenant, user_id: f.techId })
        .update({ state: 'revoked', revoked_at: new Date(), updated_at: new Date() });
      asUser(f.tenant, f.techId);
      expect(await getAllContacts('all')).toEqual([]);
      expect(await getContactByContactNameId(f.seatContact)).toBeNull();
    }, HOOK_TIMEOUT);
  });
});
