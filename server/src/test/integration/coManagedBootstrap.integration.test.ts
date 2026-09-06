import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import knex, { type Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { getSecret } from '../../lib/utils/getSecret';
import { prepareCoManagedProvisioning } from '../../../../packages/co-managed/src/provisioning';
import { bootstrapCoManagedWorkspace } from '../../../../ee/temporal-workflows/src/db/co-managed-provisioning-operations';
import { deliverCoManagedAdministratorInvitation } from '../../../../ee/temporal-workflows/src/activities/co-managed-provisioning-activities';
import { createTenantInDB } from '../../../../ee/temporal-workflows/src/db/tenant-operations';

const delivery = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('@alga-psa/email', () => ({ sendTeamInvitationEmail: delivery.send }));
// Every worker connection in this suite resolves to the disposable database.
vi.mock('@alga-psa/db/admin.js', () => ({
  getAdminConnection: async () => db,
  withAdminTransactionRetryReadOnly: (work: (trx: Knex.Transaction) => Promise<unknown>) => db.transaction(work),
}));
const require = createRequire(import.meta.url);
const databaseName = `co_managed_bootstrap_${randomUUID().replaceAll('-', '')}`;
let admin: Knex, source: Knex, db: Knex;
let created = false;
const log = { info() {}, warn() {}, error() {} };

// Copy SCHEMA ONLY from the running development database. All writes, fixtures,
// migrations, and cleanup target a new random database. Only public reference
// defaults are copied; no tenant records, credentials, or customer content.
beforeAll(async () => {
  const connection = { host: process.env.DB_HOST || 'localhost', port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER_ADMIN || 'postgres', password: await getSecret('postgres_password', 'DB_PASSWORD_ADMIN') };
  const sourceDatabase = process.env.DB_NAME_SERVER || process.env.DB_NAME || 'server';
  admin = knex({ client: 'pg', connection: { ...connection, database: 'postgres' } });
  source = knex({ client: 'pg', connection: { ...connection, database: sourceDatabase } });
  await admin.raw('CREATE DATABASE ??', [databaseName]); created = true;
  const env = { ...process.env, PGHOST: connection.host, PGPORT: String(connection.port), PGUSER: connection.user, PGPASSWORD: connection.password };
  const schema = execFileSync('pg_dump', ['--schema-only', '--no-owner', '--no-privileges', '--dbname', sourceDatabase],
    { env, maxBuffer: 100 * 1024 * 1024, timeout: 60000 });
  execFileSync('psql', ['--no-psqlrc', '--set', 'ON_ERROR_STOP=1', '--quiet', '--dbname', databaseName],
    // Newer pg_dump clients emit this session setting even for PG16 servers.
    // It is not schema; omit it when replaying against the same older server.
    { env, input: schema.toString().replace(/^SET transaction_timeout = 0;\r?\n/m, ''), maxBuffer: 100 * 1024 * 1024, timeout: 60000 });
  db = knex({ client: 'pg', connection: { ...connection, database: databaseName }, pool: { min: 0, max: 6 } });
  for (const file of ['20260906010000_create_co_management_foundation.cjs',
    '20260906020000_add_co_managed_entitlement_source_version.cjs',
    '20260906030000_create_co_managed_purchase_operations.cjs', '20260906040000_create_co_managed_provisioning.cjs',
    '20260906050000_allow_system_seeded_priorities.cjs', '20260906060000_create_co_managed_board_scopes.cjs', '20260906070000_add_co_managed_invitation_delivery.cjs']) {
    await require('../../../migrations/' + file).up(db);
  }
  for (const table of ['standard_statuses', 'standard_priorities', 'countries', 'notification_categories',
    'notification_subtypes', 'internal_notification_categories', 'internal_notification_subtypes']) {
    const rows = await source(table).select('*');
    if (rows.length) await db.batchInsert(table, rows, 100);
  }
}, 120000);

afterAll(async () => {
  await db?.destroy(); await source?.destroy();
  if (created) await admin.raw('DROP DATABASE ??', [databaseName]);
  await admin?.destroy();
  vi.unstubAllEnvs();
});

async function prepare() {
  const sponsorTenant = randomUUID(), clientId = randomUUID(), requestedBy = randomUUID(), escalationBoardId = randomUUID();
  const sponsor = tenantDb(db, sponsorTenant);
  await sponsor.table('tenants').insert({ tenant: sponsorTenant, client_name: 'MSP', email: `msp-${sponsorTenant}@example.test`,
    plan: 'pro', product_code: 'psa' });
  await sponsor.table('clients').insert({ tenant: sponsorTenant, client_id: clientId, client_name: 'Customer' });
  await sponsor.table('users').insert({ tenant: sponsorTenant, user_id: requestedBy, username: `msp-${requestedBy}`,
    email: `msp-${requestedBy}@example.test`, first_name: 'MSP', last_name: 'Admin', hashed_password: 'test-not-a-login', user_type: 'internal', is_inactive: false });
  await sponsor.table('boards').insert({ tenant: sponsorTenant, board_id: escalationBoardId, board_name: 'Escalations', is_inactive: false });
  await sponsor.table('co_managed_entitlements').insert({ tenant: sponsorTenant, source: 'hosted', source_reference: randomUUID(),
    capacity: 2, verified_at: new Date(), valid_until: new Date(Date.now() + 3600000) });
  return prepareCoManagedProvisioning(db, { sponsorTenant, clientId, requestedBy, escalationBoardId,
    operationId: randomUUID(), seats: 2, visibilityMode: 'board_scope', workspaceName: 'Customer IT',
    administrator: { firstName: 'Customer', lastName: 'Admin', email: `admin-${randomUUID()}@example.test` } });
}

describe('co-managed bootstrap against the complete installed schema', () => {
  it('creates only customer-owned operational defaults and an invitation, without an MSP login or subscription copy', async () => {
    const operation = await prepare();
    await bootstrapCoManagedWorkspace(db, operation.tenant, operation.operation_id, log);
    const customer = tenantDb(db, operation.customer_tenant);
    expect(await customer.table('tenants').first()).toMatchObject({ product_code: 'co_managed', plan: 'pro', licensed_user_count: 2 });
    expect(await customer.table('clients')).toHaveLength(1);
    expect(await customer.table('clients').first()).toMatchObject({ client_id: operation.customer_client_id, client_name: 'Customer IT' });
    expect(await customer.table('contacts')).toHaveLength(1);
    expect(await customer.table('users')).toHaveLength(0);
    expect(await customer.table('stripe_subscriptions')).toHaveLength(0);
    expect(await customer.table('stripe_customers')).toHaveLength(0);
    expect(await customer.table('boards').first()).toMatchObject({ board_id: operation.customer_board_id, is_default: true });
    expect((await customer.table('statuses').where({ board_id: operation.customer_board_id, status_type: 'ticket' })).length).toBeGreaterThan(0);
    expect((await customer.table('project_templates')).length).toBeGreaterThan(0);
    expect(await customer.table('asset_type_registry')).toHaveLength(6);
    expect(await customer.table('user_invitations').first()).toMatchObject({ invitation_id: operation.administrator_invitation_id,
      email: operation.request.administrator.email, metadata: { co_managed_initial_admin: true, co_managed_relationship_id: operation.relationship_id } });
    expect(await customer.table('co_management_relationships').first()).toMatchObject({ state: 'pending_acceptance', accepted_at: null });
    expect(await customer.table('co_management_board_scopes')).toEqual([expect.objectContaining({
      relationship_id: operation.relationship_id, board_id: operation.customer_board_id, can_collaborate: true,
    })]);
    const permissions = await customer.table('permissions');
    expect(permissions.some(permission => ['billing', 'invoice', 'rmm', 'accounting_integrations'].includes(permission.resource))).toBe(false);
  });

  it('recovers repeated worker delivery with exactly one workspace, self-client, board, and administrator invitation', async () => {
    const operation = await prepare();
    await Promise.all([
      bootstrapCoManagedWorkspace(db, operation.tenant, operation.operation_id, log),
      bootstrapCoManagedWorkspace(db, operation.tenant, operation.operation_id, log),
    ]);
    const customer = tenantDb(db, operation.customer_tenant);
    const invitation = await customer.table('user_invitations').first();
    await bootstrapCoManagedWorkspace(db, operation.tenant, operation.operation_id, log);
    for (const table of ['tenants', 'clients', 'boards', 'user_invitations']) expect(await customer.table(table), table).toHaveLength(1);
    expect((await customer.table('user_invitations').first()).token).toBe(invitation.token);
  });

  it('refuses an unreserved co-managed bootstrap through the ordinary tenant factory', async () => {
    const tenantId = randomUUID();
    await expect(db.transaction(trx => createTenantInDB({ tenantId, tenantName: 'Unreserved', email: 'not-created@example.test',
      productCode: 'co_managed', plan: 'pro', billingSource: 'manual', licenseCount: 2 }, { transaction: trx, log })))
      .rejects.toThrow('reserved operation');
    expect(await tenantDb(db, tenantId).table('tenants')).toHaveLength(0);
  });
  it('delivers only to the customer admin, retries an undelivered invitation, and never returns its token', async () => {
    const operation = await prepare();
    await bootstrapCoManagedWorkspace(db, operation.tenant, operation.operation_id, log);
    vi.stubEnv('NEXT_PUBLIC_BASE_URL', 'https://co-managed.example.test');
    delivery.send.mockReset().mockResolvedValueOnce(false).mockResolvedValue(true);
    const input = { sponsorTenant: operation.tenant, operationId: operation.operation_id };
    await expect(deliverCoManagedAdministratorInvitation(input)).rejects.toThrow('could not be delivered');
    const customer = tenantDb(db, operation.customer_tenant);
    const invitation = await customer.table('user_invitations').first();
    await customer.table('user_invitations').update({ expires_at: new Date(0) });
    expect(await deliverCoManagedAdministratorInvitation(input)).toBeUndefined();
    expect(delivery.send).toHaveBeenLastCalledWith(expect.objectContaining({
      tenant: operation.customer_tenant, email: operation.request.administrator.email, tenantName: 'Customer IT',
      inviteLink: `https://co-managed.example.test/auth/team/setup?token=${invitation.token}`,
    }));
    const stored = await tenantDb(db, operation.tenant).table('co_managed_provisioning_operations').where('operation_id', operation.operation_id).first();
    expect(stored.invitation_sent_at).not.toBeNull();
    expect(JSON.stringify(stored)).not.toContain(invitation.token);
    await deliverCoManagedAdministratorInvitation(input);
    expect(delivery.send).toHaveBeenCalledTimes(2);
    expect(await customer.table('user_invitations')).toHaveLength(1);
  });

  it('does not send an invitation for a cancelled relationship', async () => {
    const operation = await prepare();
    await bootstrapCoManagedWorkspace(db, operation.tenant, operation.operation_id, log);
    await tenantDb(db, operation.customer_tenant).table('co_management_relationships').update({ state: 'terminated', ended_at: new Date() });
    delivery.send.mockClear();
    await expect(deliverCoManagedAdministratorInvitation({ sponsorTenant: operation.tenant, operationId: operation.operation_id }))
      .rejects.toThrow('no longer pending');
    expect(delivery.send).not.toHaveBeenCalled();
  });

});
