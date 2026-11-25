/**
 * T005 (S5, F009, alga-2026-0003435): findContactByEmailAddress, findIntegrationContactByEmailAddress and
 * checkExistingEmails return only contacts in the caller's contact read scope. Same real-kernel harness as
 * clientContactScope.integration.test.ts: a bundle narrows `contact` to two of three clients.
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
  ...(await import('../../../../test-utils/rbacStandIn')).rbacStandIn(vi.fn(async () => true)),
}));

vi.mock('@alga-psa/event-bus/publishers', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  publishEvent: vi.fn(),
  publishWorkflowEvent: vi.fn(),
  publishStoredWorkflowEvent: vi.fn(),
}));

import { findContactByEmailAddress } from '../../../../../packages/clients/src/actions/queryActions';
import { checkExistingEmails } from '../../../../../packages/clients/src/actions/contact-actions/contactActions';
import { findIntegrationContactByEmailAddress } from '../../../../../packages/integrations/src/actions/clientLookupActions';

const HOOK_TIMEOUT = 900_000;

describe('contact email lookups narrowed by contact read scope (real kernel, real DB)', () => {
  let db: Knex;
  let tenant: string;
  let plainTenant: string;
  const mark = uuidv4().slice(0, 8);
  const clients = { a: uuidv4(), c: uuidv4() };
  const contacts = { a1: uuidv4(), c1: uuidv4(), orphan: uuidv4(), plain: uuidv4() };
  let restrictedId = '';
  let unrestrictedId = '';
  let adminId = '';

  const asUser = (userId: string, forTenant = tenant) => {
    ref.tenant = forTenant;
    ref.user = { user_id: userId, user_type: 'internal', tenant: forTenant, roles: [], email: `${userId}@example.com` };
  };
  const email = (key: string) => `${key}-${mark}@example.com`;
  const extra = (key: string) => `extra-${key}-${mark}@example.com`;

  beforeAll(async () => {
    db = await createTestDbConnection();
    ref.knex = db;
    tenant = await createTenant(db, `Email scope ${mark}`);
    plainTenant = await createTenant(db, `Email scope plain ${mark}`);
    adminId = await createUser(db, tenant, { first_name: 'Ada', last_name: 'Admin' });
    restrictedId = await createUser(db, tenant, { user_type: 'internal', first_name: 'Rhea', last_name: 'Restricted' });
    unrestrictedId = await createUser(db, tenant, { user_type: 'internal', first_name: 'Una', last_name: 'Unrestricted' });

    for (const [key, id] of Object.entries(clients)) {
      await db('clients').insert({ tenant, client_id: id, client_name: `Client ${key} ${mark}`, billing_cycle: 'monthly', is_tax_exempt: false, is_inactive: false });
    }
    const insertContact = (t: string, id: string, name: string, clientId: string | null, mail: string) =>
      db('contacts').insert({ tenant: t, contact_name_id: id, full_name: name, client_id: clientId, email: mail, is_inactive: false });
    await insertContact(tenant, contacts.a1, `Ann ${mark}`, clients.a, email('a1'));
    await insertContact(tenant, contacts.c1, `Cy ${mark}`, clients.c, email('c1'));
    await insertContact(tenant, contacts.orphan, `Olive ${mark}`, null, email('orphan'));
    for (const key of ['a1', 'c1', 'orphan'] as const) {
      await db('contact_additional_email_addresses').insert({
        tenant, contact_name_id: contacts[key], email_address: extra(key), canonical_type: 'work', display_order: 0,
      });
    }

    const plainClient = uuidv4();
    await db('clients').insert({ tenant: plainTenant, client_id: plainClient, client_name: `Plain ${mark}`, billing_cycle: 'monthly', is_tax_exempt: false, is_inactive: false });
    await insertContact(plainTenant, contacts.plain, `Plain ${mark}`, null, email('plain'));

    const bundle = await createAuthorizationBundle(db, { tenant, name: `contact-email-${mark}`, actorUserId: adminId });
    for (const resourceType of ['client', 'contact']) {
      await upsertBundleRule(db, {
        tenant, bundleId: bundle.bundleId, revisionId: bundle.revisionId,
        resourceType, action: 'read', templateKey: 'selected_clients',
        config: { selectedClientIds: [clients.a] }, actorUserId: adminId,
      });
    }
    await publishBundleRevision(db as any, { tenant, bundleId: bundle.bundleId, revisionId: bundle.revisionId, actorUserId: adminId });
    await createBundleAssignment(db, { tenant, bundleId: bundle.bundleId, targetType: 'user', targetId: restrictedId, actorUserId: adminId });
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    for (const t of [tenant, plainTenant]) {
      await db('contact_additional_email_addresses').where({ tenant: t }).del().catch(() => undefined);
      await db('contacts').where({ tenant: t }).del().catch(() => undefined);
    }
    await db.destroy();
  }, HOOK_TIMEOUT);

  describe('restricted user', () => {
    it('findContactByEmailAddress returns only the in-scope contact', async () => {
      asUser(restrictedId);
      expect((await findContactByEmailAddress(email('a1')))?.contact_name_id).toBe(contacts.a1);
      expect(await findContactByEmailAddress(email('c1'))).toBeNull();
      expect(await findContactByEmailAddress(email('orphan'))).toBeNull();
    }, HOOK_TIMEOUT);

    it('findIntegrationContactByEmailAddress returns only the in-scope contact, with client name', async () => {
      asUser(restrictedId);
      const hit = await findIntegrationContactByEmailAddress(email('a1'));
      expect(hit?.contact_name_id).toBe(contacts.a1);
      expect(hit?.client_name).toBe(`Client a ${mark}`);
      expect(await findIntegrationContactByEmailAddress(email('c1'))).toBeNull();
      expect(await findIntegrationContactByEmailAddress(email('orphan'))).toBeNull();
    }, HOOK_TIMEOUT);

    it('checkExistingEmails reports only in-scope emails, primary and additional', async () => {
      asUser(restrictedId);
      const result = await checkExistingEmails([
        email('a1'), email('c1'), email('orphan'), extra('a1'), extra('c1'), extra('orphan'), email('nobody'),
      ]);
      expect(Array.isArray(result)).toBe(true);
      expect([...(result as string[])].sort()).toEqual([email('a1'), extra('a1')].sort());
    }, HOOK_TIMEOUT);
  });

  describe('unrestricted', () => {
    it('a user outside the bundle gets the unchanged results', async () => {
      asUser(unrestrictedId);
      expect((await findContactByEmailAddress(email('c1')))?.contact_name_id).toBe(contacts.c1);
      expect((await findContactByEmailAddress(email('orphan')))?.contact_name_id).toBe(contacts.orphan);
      expect((await findIntegrationContactByEmailAddress(email('c1')))?.contact_name_id).toBe(contacts.c1);
      const all = [email('a1'), email('c1'), email('orphan'), extra('a1'), extra('c1'), extra('orphan')];
      expect([...((await checkExistingEmails(all)) as string[])].sort()).toEqual([...all].sort());
    }, HOOK_TIMEOUT);

    it('a tenant with no bundles behaves as before', async () => {
      const plainUser = await createUser(db, plainTenant, { user_type: 'internal' });
      asUser(plainUser, plainTenant);
      expect((await findContactByEmailAddress(email('plain')))?.contact_name_id).toBe(contacts.plain);
      expect((await checkExistingEmails([email('plain')])) as string[]).toEqual([email('plain')]);
    }, HOOK_TIMEOUT);
  });
});
