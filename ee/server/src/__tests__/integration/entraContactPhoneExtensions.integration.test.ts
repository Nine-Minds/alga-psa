// Integration coverage for Teams Phone extensions and continue-on-error in the Entra sync loop.
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
import { executeEntraSync } from '@ee/lib/integrations/entra/sync/syncEngine';
import userIssuesMigration from '../../../migrations/20261116120000_add_entra_sync_run_tenant_user_issues.cjs';
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


function buildUser(id: string, extra: Record<string, unknown> = {}): any {
  return {
    entraTenantId: fixtureEntraTenantId, entraObjectId: id, userPrincipalName: `${id}@example.test`, email: `${id}@example.test`,
    displayName: id, givenName: id, surname: 'Test', accountEnabled: true, userType: 'Member', assignedLicenseCount: 1,
    jobTitle: null, mobilePhone: null, businessPhones: [], raw: {}, ...extra,
  };
}

const PHONE_CONFIG = { phone: true };

describe('Entra Teams Phone extension PostgreSQL integration', () => {
  let db: Knex;
  let managedTenantId: string;
  let entraTenantId: string;
  let clientId: string;

  const phoneRows = (contactNameId: string) => state.trx('contact_phone_numbers')
    .where({ tenant: state.tenant, contact_name_id: contactNameId }).orderBy('display_order').select('phone_number', 'extension', 'canonical_type');
  const contactByEmail = (email: string) => state.trx('contacts').where({ tenant: state.tenant, email }).first();

  beforeAll(async () => {
    dotenv.config({ path: resolve(repoRoot, 'server/.env') });
    dotenv.config({ path: resolve(repoRoot, 'server/.env.local') });
    db = knex({ client: 'pg', connection: {
      host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 5472),
      database: process.env.ENTRA_DIAGNOSTICS_TEST_DB || process.env.TEST_DB_NAME || process.env.DB_NAME || 'server',
      user: process.env.DB_USER_ADMIN || 'postgres', password: adminPassword(),
    }, pool: { min: 0, max: 2 } });
    await db.raw('select 1');
  });

  beforeEach(async () => {
    state.trx = await db.transaction();
    await contactKindMigration.up(state.trx);
    state.tenant = randomUUID();
    state.userId = randomUUID();
    managedTenantId = randomUUID();
    entraTenantId = randomUUID();
    fixtureEntraTenantId = entraTenantId;
    clientId = randomUUID();
    await state.trx('tenants').insert({ tenant: state.tenant, client_name: `Phone ext ${state.tenant}`, email: `${state.tenant}@example.test` });
    await state.trx('clients').insert({ tenant: state.tenant, client_id: clientId, client_name: 'Phone ext client' });
    await state.trx('entra_managed_tenants').insert({ tenant: state.tenant, managed_tenant_id: managedTenantId, entra_tenant_id: entraTenantId, display_name: 'Phone ext directory' });
  });

  afterAll(async () => { await db?.destroy(); });
  afterEach(async () => { if (state.trx && !state.trx.isCompleted()) await state.trx.rollback(); });

  it('creates a contact whose phone row is split into number and extension', async () => {
    const user = buildUser('ext-create', { businessPhones: ['+14165551234;ext=228'] });
    const result = await executeEntraSync({ tenantId: state.tenant, clientId, managedTenantId, users: [user] });
    expect(result.counters).toMatchObject({ created: 1, failed: 0 });
    const contact = await contactByEmail(user.email);
    expect(await phoneRows(contact.contact_name_id)).toEqual([
      { phone_number: '+14165551234', extension: '228', canonical_type: 'work' },
    ]);
  });

  it('re-sync of the linked contact does not throw or count as updated; a changed extension does', async () => {
    const user = buildUser('ext-resync', { businessPhones: ['+14165551234;ext=228'] });
    await executeEntraSync({ tenantId: state.tenant, clientId, managedTenantId, users: [user], fieldSyncConfig: PHONE_CONFIG });
    const contact = await contactByEmail(user.email);

    const again = await executeEntraSync({ tenantId: state.tenant, clientId, managedTenantId, users: [user], fieldSyncConfig: PHONE_CONFIG });
    expect(again.counters).toMatchObject({ linked: 1, updated: 0, failed: 0 });
    expect(await phoneRows(contact.contact_name_id)).toEqual([{ phone_number: '+14165551234', extension: '228', canonical_type: 'work' }]);

    const changedUser = { ...user, businessPhones: ['+14165551234;ext=999'] };
    const preview = await executeEntraSync({ tenantId: state.tenant, clientId, managedTenantId, users: [changedUser], fieldSyncConfig: PHONE_CONFIG, dryRun: true });
    expect(preview.counters.updated).toBe(1);
    const changed = await executeEntraSync({ tenantId: state.tenant, clientId, managedTenantId, users: [changedUser], fieldSyncConfig: PHONE_CONFIG });
    expect(changed.counters).toMatchObject({ updated: 1, failed: 0 });
    expect(await phoneRows(contact.contact_name_id)).toEqual([{ phone_number: '+14165551234', extension: '999', canonical_type: 'work' }]);
  });

  it('splits the phone row when an existing client contact is matched by email', async () => {
    const user = buildUser('ext-link', { businessPhones: ['(416) 555-1234 ext. 77'] });
    const existing = await ContactModel.createContact({ full_name: 'Existing', email: user.email, client_id: clientId }, state.tenant, state.trx);
    const result = await executeEntraSync({ tenantId: state.tenant, clientId, managedTenantId, users: [user], fieldSyncConfig: PHONE_CONFIG });
    expect(result.counters).toMatchObject({ linked: 1, failed: 0 });
    expect(await phoneRows(existing.contact_name_id)).toEqual([{ phone_number: '(416) 555-1234', extension: '77', canonical_type: 'work' }]);
  });

  it('a user that cannot be created sits between two good users: both are created and failed === 1', async () => {
    const first = buildUser('ok-first');
    const broken = buildUser('broken', { email: null, userPrincipalName: null });
    const third = buildUser('ok-third');
    const result = await executeEntraSync({ tenantId: state.tenant, clientId, managedTenantId, users: [first, broken, third] });
    expect(result.counters).toMatchObject({ created: 2, failed: 1 });
    expect(await contactByEmail(first.email)).toBeTruthy();
    expect(await contactByEmail(third.email)).toBeTruthy();
    expect(result.userIssues.filter((issue) => issue.severity === 'failure')).toEqual([
      expect.objectContaining({ stage: 'create', entraObjectId: 'broken', message: 'Cannot create contact for Entra user without email/UPN.' }),
    ]);
  });

  it('migrates entra_sync_run_tenants failed_count and user_issues transactionally', async () => {
    if (!(await state.trx.schema.hasTable('entra_sync_run_tenants'))) return;
    await userIssuesMigration.up(state.trx);
    expect(await state.trx.schema.hasColumn('entra_sync_run_tenants', 'failed_count')).toBe(true);
    expect(await state.trx.schema.hasColumn('entra_sync_run_tenants', 'user_issues')).toBe(true);
    await userIssuesMigration.up(state.trx);
    await userIssuesMigration.down(state.trx);
    expect(await state.trx.schema.hasColumn('entra_sync_run_tenants', 'failed_count')).toBe(false);
    await userIssuesMigration.up(state.trx);
  });
});
