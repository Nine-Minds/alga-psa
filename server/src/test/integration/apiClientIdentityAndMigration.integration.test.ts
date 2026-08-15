import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { resolve } from 'node:path';

import { createTestDbConnection, wireLocalTestDbEnv } from '../../../test-utils/dbConfig';
import { describeWithDb } from '../../../test-utils/requireDb';
import { findUserByIdForApi } from '@alga-psa/users/actions';

const describeDb = await describeWithDb();

let db: Knex;
const tenantsToCleanup = new Set<string>();

function tenantTable(tenantId: string, table: string) {
  return db.from(table).where({ tenant: tenantId });
}

function unscopedRows(table: string) {
  return db(table);
}

async function insertTenant(tenantId: string): Promise<void> {
  tenantsToCleanup.add(tenantId);
  await unscopedRows('tenants').insert({
    tenant: tenantId,
    client_name: `Tenant ${tenantId.slice(0, 8)}`,
    email: `tenant-${tenantId.slice(0, 8)}@example.com`,
    product_code: 'psa',
  });
}

async function insertUser(
  tenantId: string,
  user: { user_id: string; username: string; user_type: 'internal' | 'client'; contact_id?: string | null }
): Promise<void> {
  await unscopedRows('users').insert({
    tenant: tenantId,
    user_id: user.user_id,
    username: user.username,
    hashed_password: 'not-used',
    email: `${user.username}@example.com`,
    user_type: user.user_type,
    is_inactive: false,
    contact_id: user.contact_id ?? null,
  });
}

async function insertClient(tenantId: string, clientId: string): Promise<void> {
  await unscopedRows('clients').insert({
    tenant: tenantId,
    client_id: clientId,
    client_name: `Client ${clientId.slice(0, 8)}`,
    is_inactive: false,
  });
}

async function insertContact(
  tenantId: string,
  contact: { contact_name_id: string; client_id: string | null; portal_visibility_group_id?: string | null }
): Promise<void> {
  await unscopedRows('contacts').insert({
    tenant: tenantId,
    contact_name_id: contact.contact_name_id,
    client_id: contact.client_id,
    full_name: `Contact ${contact.contact_name_id.slice(0, 8)}`,
    email: `contact-${contact.contact_name_id.slice(0, 8)}@example.com`,
    portal_visibility_group_id: contact.portal_visibility_group_id ?? null,
  });
}

async function cleanupAll(): Promise<void> {
  for (const tenantId of tenantsToCleanup) {
    await tenantTable(tenantId, 'api_keys').del().catch(() => undefined);
    await tenantTable(tenantId, 'contacts').del().catch(() => undefined);
    await tenantTable(tenantId, 'users').del().catch(() => undefined);
    await unscopedRows('tenants').where({ tenant: tenantId }).del().catch(() => undefined);
  }
  tenantsToCleanup.clear();
}

describeDb('API client identity and client-owned key migration', () => {
  beforeAll(async () => {
    wireLocalTestDbEnv();
    db = await createTestDbConnection({ runSeeds: false });
  }, 300000);

  afterAll(async () => {
    await cleanupAll();
    await db?.destroy();
  });

  describe('findUserByIdForApi derives clientId from the tenant-scoped contact', () => {
    it('resolves the contact client_id as clientId for a client user', async () => {
      const tenantId = uuidv4();
      const clientId = uuidv4();
      const contactId = uuidv4();
      const userId = uuidv4();
      await insertTenant(tenantId);
      await insertClient(tenantId, clientId);
      await insertContact(tenantId, { contact_name_id: contactId, client_id: clientId });
      await insertUser(tenantId, { user_id: userId, username: 'client-a', user_type: 'client', contact_id: contactId });

      const user = await findUserByIdForApi(userId, tenantId);

      expect(user?.clientId).toBe(clientId);
      expect(user?.user_type).toBe('client');
      expect(user?.contact_id).toBe(contactId);
    });

    it('does not derive a client scope for an internal user', async () => {
      const tenantId = uuidv4();
      const userId = uuidv4();
      await insertTenant(tenantId);
      await insertUser(tenantId, { user_id: userId, username: 'internal-1', user_type: 'internal' });

      const user = await findUserByIdForApi(userId, tenantId);

      expect(user?.user_type).toBe('internal');
      expect(user).not.toHaveProperty('clientId');
    });

    it('leaves clientId unresolved when the client user has no contact', async () => {
      const tenantId = uuidv4();
      const userId = uuidv4();
      await insertTenant(tenantId);
      await insertUser(tenantId, { user_id: userId, username: 'no-contact', user_type: 'client', contact_id: null });

      const user = await findUserByIdForApi(userId, tenantId);

      expect(user?.user_type).toBe('client');
      expect(user).not.toHaveProperty('clientId');
    });

    it('leaves clientId unresolved when the contact has no client', async () => {
      const tenantId = uuidv4();
      const contactId = uuidv4();
      const userId = uuidv4();
      await insertTenant(tenantId);
      await insertContact(tenantId, { contact_name_id: contactId, client_id: null });
      await insertUser(tenantId, { user_id: userId, username: 'no-client', user_type: 'client', contact_id: contactId });

      const user = await findUserByIdForApi(userId, tenantId);

      expect(user?.user_type).toBe('client');
      expect(user).not.toHaveProperty('clientId');
    });

    it('resolves only the same-tenant contact, never a same-ID contact from another tenant', async () => {
      const tenantIdA = uuidv4();
      const tenantIdB = uuidv4();
      const userId = uuidv4();
      const contactId = uuidv4();
      const clientIdA = uuidv4();
      const clientIdB = uuidv4();
      await insertTenant(tenantIdA);
      await insertTenant(tenantIdB);
      await insertClient(tenantIdA, clientIdA);
      await insertClient(tenantIdB, clientIdB);
      // The same contact_name_id exists in both tenants, but with different
      // clients. The composite users.contact_id FK binds the user to tenant A's
      // contact; resolution must use tenant A's client_id, not tenant B's.
      await insertContact(tenantIdA, { contact_name_id: contactId, client_id: clientIdA });
      await insertContact(tenantIdB, { contact_name_id: contactId, client_id: clientIdB });
      await insertUser(tenantIdA, { user_id: userId, username: 'same-id-contact', user_type: 'client', contact_id: contactId });

      const user = await findUserByIdForApi(userId, tenantIdA);

      expect(user?.user_type).toBe('client');
      expect(user?.clientId).toBe(clientIdA);
      expect(user?.clientId).not.toBe(clientIdB);
    });

    it('keeps sensitive user fields out of the API context', async () => {
      const tenantId = uuidv4();
      const userId = uuidv4();
      await insertTenant(tenantId);
      await unscopedRows('users').insert({
        tenant: tenantId,
        user_id: userId,
        username: 'sensitive-check',
        hashed_password: 'hash',
        email: 'sensitive@example.com',
        user_type: 'internal',
        is_inactive: false,
        two_factor_secret: 'totp-secret',
      });

      const user = await findUserByIdForApi(userId, tenantId);

      expect(user).not.toHaveProperty('hashed_password');
      expect(user).not.toHaveProperty('two_factor_secret');
      expect(user).not.toHaveProperty('api_key');
    });
  });

  describe('client-owned API-key migration', () => {
    const migrationPath = resolve(__dirname, '../../../migrations/20260814120000_deactivate_client_user_api_keys.cjs');

    it('deactivates active client-owned keys, keeps internal keys, is idempotent, and down does nothing', async () => {
      const tenantId = uuidv4();
      const clientUserId = uuidv4();
      const internalUserId = uuidv4();
      await insertTenant(tenantId);
      await insertUser(tenantId, { user_id: clientUserId, username: 'mig-client', user_type: 'client' });
      await insertUser(tenantId, { user_id: internalUserId, username: 'mig-internal', user_type: 'internal' });

      const clientActiveKey = uuidv4();
      const clientInactiveKey = uuidv4();
      const internalActiveKey = uuidv4();

      await unscopedRows('api_keys').insert([
        { api_key_id: clientActiveKey, api_key: 'hash-client-active', user_id: clientUserId, tenant: tenantId, active: true },
        { api_key_id: clientInactiveKey, api_key: 'hash-client-inactive', user_id: clientUserId, tenant: tenantId, active: false },
        { api_key_id: internalActiveKey, api_key: 'hash-internal-active', user_id: internalUserId, tenant: tenantId, active: true },
      ]);

      // Second tenant to prove the join requires both tenant and user_id.
      const otherTenantId = uuidv4();
      await insertTenant(otherTenantId);
      await insertUser(otherTenantId, { user_id: clientUserId, username: 'mig-other-tenant', user_type: 'internal' });
      const otherTenantKey = uuidv4();
      await unscopedRows('api_keys').insert({
        api_key_id: otherTenantKey,
        api_key: 'hash-other-tenant',
        user_id: clientUserId,
        tenant: otherTenantId,
        active: true,
      });

      const migration = await import(migrationPath);

      // First run: only the active client-owned key in the client tenant flips.
      await migration.up(db);
      const afterFirst = await unscopedRows('api_keys').select('api_key_id', 'active').orderBy('api_key_id');
      const byId = Object.fromEntries(afterFirst.map((row: { api_key_id: string; active: boolean }) => [row.api_key_id, row.active]));
      expect(byId[clientActiveKey]).toBe(false);
      expect(byId[clientInactiveKey]).toBe(false);
      expect(byId[internalActiveKey]).toBe(true);
      // Same user_id but internal in the other tenant must stay active.
      expect(byId[otherTenantKey]).toBe(true);

      // Second run changes nothing.
      const snapshotBefore = JSON.stringify(await unscopedRows('api_keys').select('api_key_id', 'active', 'updated_at').orderBy('api_key_id'));
      await migration.up(db);
      const snapshotAfter = JSON.stringify(await unscopedRows('api_keys').select('api_key_id', 'active', 'updated_at').orderBy('api_key_id'));
      expect(snapshotAfter).toBe(snapshotBefore);

      // Down is an intentional no-op: nothing is reactivated.
      await migration.down(db);
      const afterDown = await unscopedRows('api_keys').select('api_key_id', 'active').orderBy('api_key_id');
      const byIdDown = Object.fromEntries(afterDown.map((row: { api_key_id: string; active: boolean }) => [row.api_key_id, row.active]));
      expect(byIdDown[clientActiveKey]).toBe(false);
      expect(byIdDown[internalActiveKey]).toBe(true);
      expect(byIdDown[otherTenantKey]).toBe(true);
    });
  });
});
