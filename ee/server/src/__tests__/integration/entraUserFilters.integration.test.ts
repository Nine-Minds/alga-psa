// Integration coverage for managed-tenant filter storage and contact lifecycle.
// Runs against the wired dev PostgreSQL in a transaction; it never resets the DB.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import dotenv from 'dotenv';
import knex, { type Knex } from 'knex';

const state = vi.hoisted(() => ({ trx: null as unknown as Knex.Transaction, tenant: '', userId: '' }));
const repoRoot = existsSync(resolve(process.cwd(), 'server')) ? process.cwd() : resolve(process.cwd(), '../..');
let fixtureEntraTenantId = '';
vi.mock('@/lib/db', () => ({ createTenantKnex: async () => ({ knex: state.trx }), runWithTenant: async (_tenant: string, fn: () => Promise<unknown>) => fn() }));
vi.mock('@ee/lib/db', () => ({ createTenantKnex: async () => ({ knex: state.trx }), runWithTenant: async (_tenant: string, fn: () => Promise<unknown>) => fn() }));
vi.mock('../../app/api/integrations/entra/_guards', () => ({
  requireEntraAccess: async () => ({ tenantId: state.tenant, userId: state.userId }),
}));

import { ContactModel } from '@alga-psa/shared/models/contactModel';
import { filterEntraUsersForManagedTenant } from '@ee/lib/integrations/entra/settingsService';
import { executeEntraSync } from '@ee/lib/integrations/entra/sync/syncEngine';
import { markExcludedEntraUsersInactive } from '@ee/lib/integrations/entra/sync/disableHandler';
import filterMigration from '../../../migrations/20260923120000_entra_managed_tenant_user_filters.cjs';
import contactKindMigration from '../../../../../server/migrations/20260924120000_add_contact_kind.cjs';

function adminPassword(): string {
  const composeSecret = process.env.POSTGRES_PASSWORD_FILE?.startsWith('/run/secrets/')
    ? resolve(repoRoot, 'secrets', process.env.POSTGRES_PASSWORD_FILE.split('/').at(-1)!)
    : undefined;
  const configured = process.env.DB_PASSWORD_ADMIN;
  const secretPath = configured?.startsWith('/run/secrets/')
    ? resolve(repoRoot, 'secrets', configured.split('/').at(-1)!)
    : configured;
  const configuredFile = secretPath?.startsWith('/') ? secretPath : undefined;
  const candidates = [composeSecret, resolve(repoRoot, 'secrets/postgres_password'), configuredFile].filter(Boolean) as string[];
  for (const candidate of candidates) {
    try { return readFileSync(candidate, 'utf8').trim(); } catch { /* try the compose secret fallback */ }
  }
  if (configured && !configured.startsWith('/')) return configured;
  throw new Error('PostgreSQL admin password is not configured in server/.env or a local secret file.');
}

describe('Entra user filter PostgreSQL integration', () => {
  let db: Knex;
  let managedTenantId: string;
  let entraTenantId: string;
  let clientId: string;

  beforeAll(async () => {
    dotenv.config({ path: resolve(repoRoot, 'server/.env') });
    dotenv.config({ path: resolve(repoRoot, 'server/.env.local') });
    db = knex({ client: 'pg', connection: {
      host: '127.0.0.1', port: 5472,
      database: process.env.ENTRA_DIAGNOSTICS_TEST_DB || process.env.TEST_DB_NAME || process.env.DB_NAME || 'server',
      user: process.env.DB_USER_ADMIN || 'postgres', password: adminPassword(),
    }, pool: { min: 0, max: 2 } });
    await db.raw('select 1');
  });

  beforeEach(async () => {
    state.trx = await db.transaction();
    await filterMigration.up(state.trx);
    await contactKindMigration.up(state.trx);
    state.tenant = randomUUID();
    state.userId = randomUUID();
    managedTenantId = randomUUID();
    entraTenantId = randomUUID();
    fixtureEntraTenantId = entraTenantId;
    clientId = randomUUID();
    await state.trx('tenants').insert({ tenant: state.tenant, client_name: `Filter integration ${state.tenant}`, email: `${state.tenant}@example.test` });
    await state.trx('clients').insert({ tenant: state.tenant, client_id: clientId, client_name: 'Filter integration client' });
    await state.trx('entra_managed_tenants').insert({ tenant: state.tenant, managed_tenant_id: managedTenantId, entra_tenant_id: entraTenantId, display_name: 'Filter directory' });
    await state.trx('entra_sync_settings').insert({ tenant: state.tenant, sync_enabled: true, user_filter_config: JSON.stringify({ version: 1, memberUsersOnly: false, licensedUsersOnly: false, includeGroupIds: [], excludeGroupIds: [], exclusionPatterns: [], deactivateExcludedContacts: false }) });
  });

  afterAll(async () => { await db?.destroy(); });
  afterEach(async () => { if (state.trx && !state.trx.isCompleted()) await state.trx.rollback(); });

  it('runs migration up/down transactionally and supports override CRUD with tenant isolation through the filters routes', async () => {
    await filterMigration.up(state.trx);
    expect(await state.trx.schema.hasTable('entra_managed_tenant_user_filters')).toBe(true);
    await filterMigration.down(state.trx);
    expect(await state.trx.schema.hasTable('entra_managed_tenant_user_filters')).toBe(false);
    await filterMigration.up(state.trx);

    const [{ GET, POST }] = await Promise.all([
      import('../../app/api/integrations/entra/filters/[managedTenantId]/route'),
      import('../../app/api/integrations/entra/filters/route'),
    ]).then(([managed]) => [managed]);
    const response = await POST(new Request('http://localhost/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ override: { version: 1, memberUsersOnly: true, licensedUsersOnly: true, includeGroupIds: ['group-a'], excludeGroupIds: [], exclusionPatterns: [], deactivateExcludedContacts: false } }) }), { params: Promise.resolve({ managedTenantId }) });
    expect(response.status).toBe(200);
    expect((await response.json() as any).data.effective).toMatchObject({ memberUsersOnly: true, licensedUsersOnly: true, includeGroupIds: ['group-a'] });
    state.tenant = randomUUID();
    const foreignRead = await GET(new Request('http://localhost/api'), { params: Promise.resolve({ managedTenantId }) });
    expect(foreignRead.status).toBe(400);
    await state.trx.rollback();
  });

  it('filters include-group plus licensed-only users before creating contacts', async () => {
    const users = [
      buildUser('included', { assignedLicenseCount: 1 }),
      buildUser('outside-group', { assignedLicenseCount: 1 }),
      buildUser('unlicensed', { assignedLicenseCount: 0 }),
    ];
    const adapter = { listSecurityGroupMemberIds: async () => new Set(['included']) } as any;
    await state.trx('entra_managed_tenant_user_filters').insert({ tenant: state.tenant, managed_tenant_id: managedTenantId, filter_config: JSON.stringify({ version: 1, memberUsersOnly: false, licensedUsersOnly: true, includeGroupIds: ['allow'], excludeGroupIds: [], exclusionPatterns: [], deactivateExcludedContacts: false }) });
    const filtered = await filterEntraUsersForManagedTenant({ tenant: state.tenant, managedTenantId, entraTenantId, adapter, users });
    expect(filtered.included.map(user => user.entraObjectId)).toEqual(['included']);
    await executeEntraSync({ tenantId: state.tenant, clientId, managedTenantId, users: filtered.included });
    const contacts = await state.trx('contacts').where({ tenant: state.tenant, client_id: clientId }).select('email');
    expect(contacts.map((contact: any) => contact.email)).toEqual(['included@example.test']);
    await state.trx.rollback();
  });

  it('migrates contact_kind transactionally and imports or preserves shared mailboxes according to the toggle', async () => {
    expect(await state.trx.schema.hasColumn('contacts', 'contact_kind')).toBe(true);
    await contactKindMigration.down(state.trx);
    expect(await state.trx.schema.hasColumn('contacts', 'contact_kind')).toBe(false);
    await contactKindMigration.up(state.trx);
    await expect(state.trx.transaction(async (trx) => trx('contacts').insert({ tenant: state.tenant, contact_name_id: randomUUID(), full_name: 'Invalid kind', email: `${randomUUID()}@example.test`, contact_kind: 'room' }))).rejects.toThrow();

    const mailbox = buildUser('shared-mailbox', { mailboxKind: null, accountEnabled: false, assignedLicenseCount: 0 });
    const adapter = { listSharedMailboxIds: async () => new Set([mailbox.entraObjectId, 'shared-existing']), listSecurityGroupMemberIds: async () => new Set() } as any;
    await state.trx('entra_managed_tenant_user_filters').insert({ tenant: state.tenant, managed_tenant_id: managedTenantId, filter_config: JSON.stringify({ importSharedMailboxes: true }) });
    const enabled = await filterEntraUsersForManagedTenant({ tenant: state.tenant, managedTenantId, entraTenantId, adapter, users: [mailbox] });
    expect(enabled.included[0]).toMatchObject({ mailboxKind: 'shared', accountEnabled: false });
    await executeEntraSync({ tenantId: state.tenant, clientId, managedTenantId, users: enabled.included });
    let contact = await state.trx('contacts').where({ tenant: state.tenant, email: mailbox.email }).first();
    expect(contact.contact_kind).toBe('shared_mailbox');
    expect(contact.is_inactive).toBe(false);

    // If a later provider run cannot classify mailboxes, linking the same
    // contact must preserve its stored shared kind.
    await executeEntraSync({
      tenantId: state.tenant, clientId, managedTenantId,
      users: [{ ...mailbox, mailboxKind: null, accountEnabled: true }],
    });
    contact = await state.trx('contacts').where({ tenant: state.tenant, email: mailbox.email }).first();
    expect(contact.contact_kind).toBe('shared_mailbox');

    const imported = await ContactModel.createContact({ full_name: 'Existing mailbox', email: 'existing-shared@example.test', client_id: clientId }, state.tenant, state.trx);
    await state.trx('contacts').where({ tenant: state.tenant, contact_name_id: imported.contact_name_id }).update({ contact_kind: 'shared_mailbox' });
    await state.trx('entra_contact_links').insert({ tenant: state.tenant, contact_name_id: imported.contact_name_id, client_id: clientId, entra_tenant_id: entraTenantId, entra_object_id: 'shared-existing', link_status: 'active', is_active: true });
    await state.trx('entra_managed_tenant_user_filters').where({ tenant: state.tenant, managed_tenant_id: managedTenantId }).update({ filter_config: JSON.stringify({ importSharedMailboxes: false }) });
    const disabled = await filterEntraUsersForManagedTenant({ tenant: state.tenant, managedTenantId, entraTenantId, adapter, users: [buildUser('shared-existing', { mailboxKind: null, accountEnabled: false, assignedLicenseCount: 0 })] });
    expect(disabled.excluded[0].reason).toBe('shared_mailbox');
    expect(disabled.deactivateExcludedContacts).toBe(false);
    await executeEntraSync({ tenantId: state.tenant, clientId, managedTenantId, users: disabled.included, disabledIdentities: [] });
    contact = await state.trx('contacts').where({ tenant: state.tenant, contact_name_id: imported.contact_name_id }).first();
    expect(contact).toMatchObject({ contact_kind: 'shared_mailbox', is_inactive: false });
  });

  it('only reactivates filter-deactivated contacts, and the all-excluded brake preserves contacts', async () => {
    const filteredContact = await ContactModel.createContact({ full_name: 'Filtered user', email: 'filtered@example.test', client_id: clientId }, state.tenant, state.trx);
    const manualContact = await ContactModel.createContact({ full_name: 'Manual user', email: 'manual@example.test', client_id: clientId, is_inactive: true }, state.tenant, state.trx);
    const upstreamContact = await ContactModel.createContact({ full_name: 'Upstream disabled user', email: 'upstream@example.test', client_id: clientId }, state.tenant, state.trx);
    await state.trx('contacts').where({ tenant: state.tenant, contact_name_id: upstreamContact.contact_name_id }).update({ entra_sync_status_reason: 'disabled_upstream' });
    for (const [contact, objectId] of [[filteredContact, 'filtered'], [manualContact, 'manual'], [upstreamContact, 'upstream']] as const) {
      await state.trx('entra_contact_links').insert({ tenant: state.tenant, contact_name_id: contact.contact_name_id, client_id: clientId, entra_tenant_id: entraTenantId, entra_object_id: objectId, link_status: 'active', is_active: true });
    }
    await state.trx('contacts').where({ tenant: state.tenant, contact_name_id: manualContact.contact_name_id }).update({ entra_sync_status_reason: null });
    const excluded = await markExcludedEntraUsersInactive(state.tenant, [{ entraTenantId, entraObjectId: 'filtered' }, { entraTenantId, entraObjectId: 'manual' }, { entraTenantId, entraObjectId: 'upstream' }]);
    expect(excluded).toBe(1);
    await executeEntraSync({ tenantId: state.tenant, clientId, managedTenantId, users: [buildUser('filtered') ] });
    const filteredAfter = await state.trx('contacts').where({ tenant: state.tenant, contact_name_id: filteredContact.contact_name_id }).first();
    const manualAfter = await state.trx('contacts').where({ tenant: state.tenant, contact_name_id: manualContact.contact_name_id }).first();
    const upstreamAfter = await state.trx('contacts').where({ tenant: state.tenant, contact_name_id: upstreamContact.contact_name_id }).first();
    expect(filteredAfter.is_inactive).toBe(false);
    expect(filteredAfter.entra_sync_status_reason).toBeNull();
    expect(manualAfter.is_inactive).toBe(true);
    expect(upstreamAfter.is_inactive).toBe(false);
    expect(upstreamAfter.entra_sync_status_reason).toBe('disabled_upstream');

    const brake = await executeEntraSync({ tenantId: state.tenant, clientId, managedTenantId, users: [], excludedIdentities: [{ entraTenantId, entraObjectId: 'filtered', reason: 'guest_user' }], deactivateExcludedContacts: true, enabledSourceUserCount: 1 });
    expect(brake.warnings).toContain('Excluded contacts were left active because the filter excludes every enabled user and linked contacts exist.');
    expect((await state.trx('contacts').where({ tenant: state.tenant, contact_name_id: filteredContact.contact_name_id }).first()).is_inactive).toBe(false);
    await state.trx.rollback();
  });
});

function buildUser(id: string, extra: Record<string, unknown> = {}): any {
  return { entraTenantId: fixtureEntraTenantId, entraObjectId: id, userPrincipalName: `${id}@example.test`, email: `${id}@example.test`, displayName: id, givenName: id, surname: 'Test', accountEnabled: true, userType: 'Member', assignedLicenseCount: 1, jobTitle: null, mobilePhone: null, businessPhones: [], raw: {}, ...extra };
}
