/**
 * T011 (alga-2026-0003206, S9): a user under a bundle that narrows clients by `selected_clients` sees only those
 * clients and the contacts that belong to them. Lists, pages, counts, pickers and detail reads all come from the
 * narrowed SQL; a contact with no client is hidden from a narrowed subject. Real authorization kernel and real
 * bundle service; only the session seam (withAuth), the DB handle and the coarse RBAC grant are stood in for.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import { createTenant, createUser } from '../../../../test-utils/testDataFactory';
import {
  createAuthorizationBundle,
  createBundleAssignment,
  publishBundleRevision,
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
  // The coarse grant, also for actions that answer several permissions from one roles load.
  ...(await import('../../../../test-utils/rbacStandIn')).rbacStandIn(vi.fn(async () => true)),
}));

vi.mock('@alga-psa/event-bus/publishers', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  publishEvent: vi.fn(),
  publishWorkflowEvent: vi.fn(),
  publishStoredWorkflowEvent: vi.fn(),
}));

import { getClientById, getAllClients, getContactsByClient, getAllContacts, searchContactListIds }
  from '../../../../../packages/clients/src/actions/queryActions';
import { getAllClientsPaginated, getAllClientIds } from '../../../../../packages/clients/src/actions/clientActions';
import { searchClientsForPicker } from '../../../../../packages/clients/src/actions/clientPickerActions';
import { getContactByContactNameId, getContactByEmail, getContactsEligibleForInvitation }
  from '../../../../../packages/clients/src/actions/contact-actions/contactActions';

import * as ticketLookups from '../../../../../packages/tickets/src/actions/clientLookupActions';
import { createClientScopeContext } from '@alga-psa/authorization/clientScopeAuthorization';
import { getAllClients as getAllClientsModel, getClientById as getClientByIdModel } from '@alga-psa/shared/ticketClients/clients';
import {
  getAllActiveContacts as getAllActiveContactsModel,
  getContactsByClient as getContactsByClientModel,
} from '@alga-psa/shared/ticketClients/contacts';
import { searchClientsForPicker as searchClientsForPickerModel } from '@alga-psa/shared/ticketClients/clientPicker';
import { attachDisplayTags } from '@alga-psa/tags/lib/displayTags';
import { getClientLogoUrl } from '@alga-psa/formatting/avatarUtils';

const HOOK_TIMEOUT = 900_000;

describe('client and contact reads narrowed by a client-scoped bundle (real kernel, real DB)', () => {
  let db: Knex;
  let tenant: string;
  let plainTenant: string;
  const mark = uuidv4().slice(0, 8);
  const clients = { a: uuidv4(), b: uuidv4(), c: uuidv4() };
  const contacts = { a1: uuidv4(), b1: uuidv4(), c1: uuidv4(), orphan: uuidv4() };
  const locations = { a: uuidv4(), b: uuidv4(), c: uuidv4() };
  let restrictedId = '';
  let unrestrictedId = '';
  let adminId = '';

  const asUser = (userId: string, forTenant = tenant) => {
    ref.tenant = forTenant;
    ref.user = { user_id: userId, user_type: 'internal', tenant: forTenant, roles: [], email: `${userId}@example.com` };
  };
  const emailOf = (key: keyof typeof contacts) => `${key}-${mark}@example.com`;

  async function insertClient(forTenant: string, id: string, name: string) {
    await db('clients').insert({ tenant: forTenant, client_id: id, client_name: name, billing_cycle: 'monthly', is_tax_exempt: false, is_inactive: false });
  }
  async function insertContact(forTenant: string, id: string, name: string, clientId: string | null, email: string) {
    await db('contacts').insert({ tenant: forTenant, contact_name_id: id, full_name: name, client_id: clientId, email, is_inactive: false });
  }

  beforeAll(async () => {
    db = await createTestDbConnection();
    ref.knex = db;
    tenant = await createTenant(db, `Client scope ${mark}`);
    plainTenant = await createTenant(db, `Client scope plain ${mark}`);
    adminId = await createUser(db, tenant, { first_name: 'Ada', last_name: 'Admin' });
    restrictedId = await createUser(db, tenant, { user_type: 'internal', first_name: 'Rhea', last_name: 'Restricted' });
    unrestrictedId = await createUser(db, tenant, { user_type: 'internal', first_name: 'Una', last_name: 'Unrestricted' });

    await insertClient(tenant, clients.a, `Alpha ${mark}`);
    await insertClient(tenant, clients.b, `Bravo ${mark}`);
    await insertClient(tenant, clients.c, `Charlie ${mark}`);
    await insertContact(tenant, contacts.a1, `Ann Alpha ${mark}`, clients.a, emailOf('a1'));
    await insertContact(tenant, contacts.b1, `Bob Bravo ${mark}`, clients.b, emailOf('b1'));
    await insertContact(tenant, contacts.c1, `Cy Charlie ${mark}`, clients.c, emailOf('c1'));
    await insertContact(tenant, contacts.orphan, `Olive Orphan ${mark}`, null, emailOf('orphan'));

    // The plain tenant has no bundles at all: the S2 fast path.
    const plainClient = uuidv4();
    await insertClient(plainTenant, plainClient, `Plain ${mark}`);
    await insertContact(plainTenant, uuidv4(), `Plain Contact ${mark}`, plainClient, `plain-${mark}@example.com`);
    await insertContact(plainTenant, uuidv4(), `Plain Orphan ${mark}`, null, `plain-orphan-${mark}@example.com`);

    for (const [key, id] of Object.entries(clients)) {
      await db('client_locations').insert({
        tenant, location_id: locations[key as keyof typeof clients], client_id: id, location_name: `Office ${key} ${mark}`,
        address_line1: '1 Main St', city: 'Town', country_code: 'US', country_name: 'United States', is_active: true,
      });
    }

    const bundle = await createAuthorizationBundle(db, { tenant, name: `two-clients-${mark}`, actorUserId: adminId });
    for (const resourceType of ['client', 'contact']) {
      await upsertBundleRule(db, {
        tenant, bundleId: bundle.bundleId, revisionId: bundle.revisionId,
        resourceType, action: 'read', templateKey: 'selected_clients',
        config: { selectedClientIds: [clients.a, clients.b] }, actorUserId: adminId,
      });
    }
    await publishBundleRevision(db as any, { tenant, bundleId: bundle.bundleId, revisionId: bundle.revisionId, actorUserId: adminId });
    await createBundleAssignment(db, { tenant, bundleId: bundle.bundleId, targetType: 'user', targetId: restrictedId, actorUserId: adminId });
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    for (const t of [tenant, plainTenant]) {
      await db('contacts').where({ tenant: t }).del().catch(() => undefined);
    }
    await db.destroy();
  }, HOOK_TIMEOUT);

  const mine = <T extends Record<string, any>>(rows: T[], key: string) => rows.filter((row) => String(row[key]).includes(mark));
  const names = (rows: any[], key: string) => mine(rows, key).map((row) => row[key]).sort();

  describe('restricted to two of three clients', () => {
    it('lists, pages and counts only the two clients', async () => {
      asUser(restrictedId);
      expect(names(await getAllClients(), 'client_name')).toEqual([`Alpha ${mark}`, `Bravo ${mark}`]);

      const page = await getAllClientsPaginated({ page: 1, pageSize: 1, sortBy: 'client_name', sortDirection: 'asc' } as any);
      expect(page.totalCount).toBe(2);
      expect(page.totalPages).toBe(2);
      expect(page.clients.map((c: any) => c.client_name)).toEqual([`Alpha ${mark}`]);
      const second = await getAllClientsPaginated({ page: 2, pageSize: 1 } as any);
      expect(second.clients.map((c: any) => c.client_name)).toEqual([`Bravo ${mark}`]);

      const ids = (await getAllClientIds()) as string[];
      expect([...ids].sort()).toEqual([clients.a, clients.b].sort());
    }, HOOK_TIMEOUT);

    it('denies detail for the third client and returns the in-scope ones', async () => {
      asUser(restrictedId);
      expect(await getClientById(clients.c)).toBeNull();
      expect((await getClientById(clients.a))?.client_id).toBe(clients.a);
    }, HOOK_TIMEOUT);

    it('picker returns only the two clients, including the lookup-by-id path', async () => {
      asUser(restrictedId);
      const result = await searchClientsForPicker({ search: mark, status: 'all' });
      expect(result.total).toBe(2);
      expect(result.clients.map((c) => c.client_id).sort()).toEqual([clients.a, clients.b].sort());

      const lookup = await searchClientsForPicker({ ids: [clients.a, clients.c] });
      expect(lookup.clients.map((c) => c.client_id)).toEqual([clients.a]);
      expect(lookup.total).toBe(1);
    }, HOOK_TIMEOUT);

    it('lists only contacts of the two clients and hides the client-less contact', async () => {
      asUser(restrictedId);
      const all = await getAllContacts('all');
      expect(names(all, 'full_name')).toEqual([`Ann Alpha ${mark}`, `Bob Bravo ${mark}`]);
      expect(mine(all, 'full_name').map((c: any) => c.contact_name_id)).not.toContain(contacts.orphan);

      expect((await getContactsByClient(clients.a, 'all')).map((c) => c.contact_name_id)).toEqual([contacts.a1]);
      await expect(getContactsByClient(clients.c, 'all')).rejects.toThrow(/does not exist/);

      const eligible = await getContactsEligibleForInvitation(undefined, 'all');
      expect(names(eligible, 'full_name')).toEqual([`Ann Alpha ${mark}`, `Bob Bravo ${mark}`]);

      expect([...(await searchContactListIds(mark))].sort()).toEqual([contacts.a1, contacts.b1].sort());
    }, HOOK_TIMEOUT);

    it('denies contact detail for a contact of the third client and for the client-less contact', async () => {
      asUser(restrictedId);
      expect(await getContactByContactNameId(contacts.c1)).toBeNull();
      expect(await getContactByContactNameId(contacts.orphan)).toBeNull();
      expect((await getContactByContactNameId(contacts.a1))?.contact_name_id).toBe(contacts.a1);
      expect(await getContactByEmail(emailOf('c1'), clients.c)).toBeNull();
      expect((await getContactByEmail(emailOf('a1'), clients.a))?.contact_name_id).toBe(contacts.a1);
    }, HOOK_TIMEOUT);
  });

  describe('restricted to two of three clients: the tickets-package lookups', () => {
    it('picker returns only the two clients and total matches', async () => {
      asUser(restrictedId);
      const result = await ticketLookups.searchClientsForPicker({ search: mark, status: 'all' });
      expect(result.total).toBe(2);
      expect(result.clients.map((c) => c.client_id).sort()).toEqual([clients.a, clients.b].sort());
      const lookup = await ticketLookups.searchClientsForPicker({ ids: [clients.a, clients.c] });
      expect(lookup.clients.map((c) => c.client_id)).toEqual([clients.a]);
      expect(lookup.total).toBe(1);
    }, HOOK_TIMEOUT);

    it('lists and reads clients in scope only', async () => {
      asUser(restrictedId);
      expect(names(await ticketLookups.getAllClients(), 'client_name')).toEqual([`Alpha ${mark}`, `Bravo ${mark}`]);
      expect(await ticketLookups.getClientById(clients.c)).toBeNull();
      expect((await ticketLookups.getClientById(clients.a))?.client_id).toBe(clients.a);
    }, HOOK_TIMEOUT);

    it('getContactsByClient throws "does not exist" out of scope and returns rows in scope', async () => {
      asUser(restrictedId);
      await expect(ticketLookups.getContactsByClient(clients.c, 'all')).rejects.toThrow(/VALIDATION_ERROR: The specified client does not exist/);
      expect((await ticketLookups.getContactsByClient(clients.a, 'all')).map((c) => c.contact_name_id)).toEqual([contacts.a1]);
    }, HOOK_TIMEOUT);

    it('contact reads hide out-of-scope and client-less contacts', async () => {
      asUser(restrictedId);
      expect(await ticketLookups.getContactByContactNameId(contacts.c1)).toBeNull();
      expect(await ticketLookups.getContactByContactNameId(contacts.orphan)).toBeNull();
      expect((await ticketLookups.getContactByContactNameId(contacts.a1))?.contact_name_id).toBe(contacts.a1);
      expect(names(await ticketLookups.getAllActiveContacts(), 'full_name')).toEqual([`Ann Alpha ${mark}`, `Bob Bravo ${mark}`]);
    }, HOOK_TIMEOUT);

    it('locations, billing profiles and contact locations do not leak out of scope', async () => {
      asUser(restrictedId);
      expect(await ticketLookups.getClientLocations(clients.c)).toEqual([]);
      expect((await ticketLookups.getClientLocations(clients.a)).map((l) => l.location_id)).toEqual([locations.a]);
      expect(await ticketLookups.getClientBillingProfiles(clients.c)).toEqual([]);
      expect((await ticketLookups.getClientBillingProfiles(clients.a)).length).toBeGreaterThan(0);
      expect(await ticketLookups.getContactEffectiveLocation(contacts.c1)).toEqual({ locationId: null, locations: [], workArrangement: null });
      expect(await ticketLookups.getContactEffectiveLocation(contacts.orphan)).toEqual({ locationId: null, locations: [], workArrangement: null });

      const mineLocs = (rows: any[]) => rows.filter((r) => String(r.location_name).includes(mark)).map((r) => r.location_id).sort();
      expect(mineLocs(await ticketLookups.listTicketFilterLocations())).toEqual([locations.a, locations.b].sort());
      expect(await ticketLookups.listTicketFilterLocations(clients.c)).toEqual([]);
      expect(mineLocs(await ticketLookups.listTicketFilterLocations(clients.a))).toEqual([locations.a]);
    }, HOOK_TIMEOUT);

    it('a user outside the bundle gets the unnarrowed answers', async () => {
      asUser(unrestrictedId);
      expect((await ticketLookups.searchClientsForPicker({ search: mark, status: 'all' })).total).toBe(3);
      expect((await ticketLookups.getClientById(clients.c))?.client_id).toBe(clients.c);
      expect((await ticketLookups.getContactsByClient(clients.c, 'all')).map((c) => c.contact_name_id)).toEqual([contacts.c1]);
      expect((await ticketLookups.getContactByContactNameId(contacts.orphan))?.contact_name_id).toBe(contacts.orphan);
      expect((await ticketLookups.getClientLocations(clients.c)).length).toBe(1);
    }, HOOK_TIMEOUT);
  });

  describe('control: no narrowing', () => {
    it('a user the bundle is not assigned to sees all three clients and every contact, including the client-less one', async () => {
      asUser(unrestrictedId);
      expect(names(await getAllClients(), 'client_name')).toEqual([`Alpha ${mark}`, `Bravo ${mark}`, `Charlie ${mark}`]);
      const page = await getAllClientsPaginated({ page: 1, pageSize: 1 } as any);
      expect(page.totalCount).toBeGreaterThanOrEqual(3);
      expect((await searchClientsForPicker({ search: mark, status: 'all' })).total).toBe(3);
      expect((await getClientById(clients.c))?.client_id).toBe(clients.c);
      expect(names(await getAllContacts('all'), 'full_name')).toEqual(
        [`Ann Alpha ${mark}`, `Bob Bravo ${mark}`, `Cy Charlie ${mark}`, `Olive Orphan ${mark}`].sort()
      );
      expect((await getContactByContactNameId(contacts.orphan))?.contact_name_id).toBe(contacts.orphan);
      expect((await getContactByContactNameId(contacts.c1))?.contact_name_id).toBe(contacts.c1);
    }, HOOK_TIMEOUT);

    it('a tenant with no bundles at all behaves as before (fast path)', async () => {
      const plainUser = await createUser(db, plainTenant, { user_type: 'internal' });
      asUser(plainUser, plainTenant);
      expect(names(await getAllClients(), 'client_name')).toEqual([`Plain ${mark}`]);
      expect(names(await getAllContacts('all'), 'full_name')).toEqual([`Plain Contact ${mark}`, `Plain Orphan ${mark}`]);
    }, HOOK_TIMEOUT);

    it('a tenant with no bundles: the tickets lookups add exactly the tenant probe to what the model alone costs', async () => {
      const plainUser = await createUser(db, plainTenant, { user_type: 'internal' });
      asUser(plainUser, plainTenant);
      const plainClient = (await db('clients').where({ tenant: plainTenant }).first('client_id')).client_id as string;
      const user = ref.user;

      // Every statement the connection sends, minus transaction control.
      const record = async (run: () => Promise<unknown>): Promise<string[]> => {
        const sqls: string[] = [];
        const onQuery = (q: { sql: string }) => { sqls.push(q.sql); };
        db.on('query', onQuery);
        try { await run(); } finally { db.removeListener('query', onQuery); }
        return sqls.filter((sql) => !/^\s*(begin|commit|rollback|savepoint|release)/i.test(sql)).sort();
      };

      const probe = await record(() => createClientScopeContext(db, plainTenant, user));
      expect(probe).toHaveLength(1);

      const expectProbeOnly = async (label: string, action: () => Promise<unknown>, baseline: () => Promise<unknown>) => {
        const without = await record(baseline);
        const withScope = await record(action);
        expect({ label, extra: withScope.length - without.length }).toEqual({ label, extra: 1 });
        expect([...without, ...probe].sort()).toEqual(withScope);
      };

      await expectProbeOnly('getAllClients', () => ticketLookups.getAllClients(), () => getAllClientsModel(db, plainTenant, true));
      await expectProbeOnly('getClientById', () => ticketLookups.getClientById(plainClient), async () => {
        await getClientByIdModel(db, plainTenant, plainClient);
        await getClientLogoUrl(plainClient, plainTenant);
      });
      await expectProbeOnly('getContactsByClient', () => ticketLookups.getContactsByClient(plainClient, 'all'),
        () => getContactsByClientModel(db, plainTenant, plainClient, 'all'));
      await expectProbeOnly('getAllActiveContacts', () => ticketLookups.getAllActiveContacts(), () => getAllActiveContactsModel(db, plainTenant));
      await expectProbeOnly('searchClientsForPicker', () => ticketLookups.searchClientsForPicker({ search: mark, status: 'all' }), async () => {
        const { clients: found } = await searchClientsForPickerModel(db, plainTenant, user, { search: mark, status: 'all' });
        await attachDisplayTags(db, plainTenant, user, 'client', found, (c: { client_id: string }) => c.client_id);
      });
    }, HOOK_TIMEOUT);
  });
});
