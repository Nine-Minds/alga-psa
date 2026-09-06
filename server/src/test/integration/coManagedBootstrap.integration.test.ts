import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import knex, { type Knex } from 'knex';
import { assertCoManagedSeatAdmission, changeCoManagedAllocation, countCoManagedCommittedSeats } from '@alga-psa/licensing';
import { assertCoManagedOperationalWrite, getCoManagedOperationalState, withCoManagedOperationalTransaction,
  reconcileHostedCoManagedEntitlement } from '@alga-psa/licensing';
import { tenantDb, runWithTenant } from '@alga-psa/db';
import { getSecret } from '../../lib/utils/getSecret';
import { prepareCoManagedProvisioning } from '../../../../packages/co-managed/src/provisioning';
import { requestCoManagedProvisioningCleanup } from '../../../../packages/co-managed/src/provisioning';
import { acceptCoManagedRelationship, getCoManagedAcceptanceState } from '../../../../packages/co-managed/src/acceptance';
import { bootstrapCoManagedWorkspace } from '../../../../ee/temporal-workflows/src/db/co-managed-provisioning-operations';
import { deliverCoManagedAdministratorInvitation } from '../../../../ee/temporal-workflows/src/activities/co-managed-provisioning-activities';
import { createTenantInDB } from '../../../../ee/temporal-workflows/src/db/tenant-operations';

vi.mock('next/cache', async importOriginal => ({
  ...await importOriginal<typeof import('next/cache')>(), revalidatePath: vi.fn(),
}));
const delivery = vi.hoisted(() => ({ send: vi.fn() }));
const statusEmail = vi.hoisted(() => ({ create: vi.fn(), send: vi.fn() }));
const intake = vi.hoisted(() => ({ read: vi.fn(), parse: vi.fn(), process: vi.fn(), stage: vi.fn() }));
const durableTransport = vi.hoisted(() => ({ enqueue: vi.fn() }));
const artifactStorage = vi.hoisted(() => ({ upload: vi.fn(), delete: vi.fn(), download: vi.fn() }));
vi.mock('@alga-psa/storage/config/storage', () => ({
  validateFileUpload: async () => {},
  getStorageConfig: async () => ({ defaultProvider: 'local' }),
  getProviderConfig: async () => ({ type: 'local' }),
}));
vi.mock('@alga-psa/storage/StorageProviderFactory', () => ({
  StorageProviderFactory: { createProvider: async () => artifactStorage },
  generateStoragePath: (tenant: string, _base: string, name: string) => `${tenant}/${randomUUID()}/${name}`,
}));
vi.mock('../../../../shared/services/email/unifiedInboundEmailQueueV2', () => ({ enqueueInboundEmailDurableJob: durableTransport.enqueue }));
vi.mock('../../../../shared/services/email/inboundEmailSourceStager', () => ({
  readStagedSourceMime: intake.read, parseStagedMimeIntoEmailDetails: intake.parse,
  stageInboundSourceMime: intake.stage,
}));
vi.mock('../../../../shared/services/email/processInboundEmailInApp', () => ({ processInboundEmailInApp: intake.process }));
vi.mock('@alga-psa/email', () => ({
  sendTeamInvitationEmail: delivery.send,
  SystemEmailProviderFactory: { createProvider: statusEmail.create },
  resolveTenantCompanyName: async () => 'Customer IT',
}));
vi.mock('@alga-psa/analytics', () => ({ ServerAnalyticsTracker: class {
  async trackTicketCreated() {}
  async trackTicketUpdated() {}
  async trackCommentCreated() {}
  async trackFeatureUsage() {}
} }));
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
    '20260906050000_allow_system_seeded_priorities.cjs', '20260906060000_create_co_managed_board_scopes.cjs', '20260906070000_add_co_managed_invitation_delivery.cjs',
    '20260906080000_create_co_management_relationship_events.cjs',
    '20260906100000_add_external_file_metadata.cjs']) {
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

async function prepare(visibilityMode: 'board_scope' | 'escalation_only' = 'board_scope') {
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
    operationId: randomUUID(), seats: 2, visibilityMode, workspaceName: 'Customer IT',
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
    const projectStatuses = await customer.table('statuses').where({ status_type: 'project' }).orderBy('order_number');
    expect(projectStatuses).toHaveLength(5);
    expect(projectStatuses.filter(status => status.is_default)).toEqual([expect.objectContaining({ name: 'Not Started' })]);
    const projectSeed = require('../../../../ee/server/seeds/onboarding/co_managed/05_project_statuses.cjs');
    await customer.table('statuses').where('status_id', projectStatuses[0].status_id).update({ name: 'Customer backlog' });
    await projectSeed.seed(db, operation.customer_tenant);
    expect(await customer.table('statuses').where({ status_type: 'project' }).orderBy('order_number'))
      .toEqual(projectStatuses.map((status, index) => index === 0 ? { ...status, name: 'Customer backlog' } : status));
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

async function readyForAcceptance(visibilityMode: 'board_scope' | 'escalation_only' = 'board_scope') {
  const operation = await prepare(visibilityMode);
  await bootstrapCoManagedWorkspace(db, operation.tenant, operation.operation_id, log);
  const customer = tenantDb(db, operation.customer_tenant), userId = randomUUID();
  await customer.table('users').insert({ tenant: operation.customer_tenant, user_id: userId, username: `customer-${userId}`,
    email: operation.request.administrator.email, first_name: 'Customer', last_name: 'Admin',
    hashed_password: 'test-not-a-login', user_type: 'internal', is_inactive: false });
  const role = await customer.table('roles').where({ role_name: 'Admin', msp: true, client: false }).first();
  await customer.table('user_roles').insert({ tenant: operation.customer_tenant, user_id: userId, role_id: role.role_id });
  await customer.table('user_invitations').where('invitation_id', operation.administrator_invitation_id).update({ used_at: new Date() });
  const actor = { tenant: operation.customer_tenant, userId };
  const review = await getCoManagedAcceptanceState(db, actor);
  if (review.state !== 'pending_acceptance') throw new Error('Expected pending acceptance');
  const input = { relationshipId: review.relationshipId, revision: review.revision, scopeFingerprint: review.scopeFingerprint };
  return { operation, customer, actor, review, input };
}

describe('customer-owned co-management acceptance', () => {
  it('atomically activates seats and records the approved scope, including concurrent retries', async () => {
    const { operation, customer, actor, review, input } = await readyForAcceptance();
    expect(review.canAccept).toBe(true);
    expect(review.scope.boards).toEqual([{ id: operation.customer_board_id, name: 'Service Desk', canCollaborate: true }]);
    await Promise.all([acceptCoManagedRelationship(db, actor, input), acceptCoManagedRelationship(db, actor, input)]);
    expect(await customer.table('co_management_relationships').first()).toMatchObject({ state: 'active', accepted_by: actor.userId, revision: 2 });
    expect(await tenantDb(db, operation.tenant).table('co_managed_allocations').first()).toMatchObject({ state: 'active' });
    const receipts = await customer.table('co_management_relationship_events');
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({ actor_tenant: actor.tenant, actor_user_id: actor.userId,
      revision: 2, scope: review.scope, scope_fingerprint: input.scopeFingerprint });
    expect(await getCoManagedAcceptanceState(db, actor)).toEqual({ state: 'active' });
    await expect(requestCoManagedProvisioningCleanup(db, operation.tenant, operation.operation_id)).rejects.toMatchObject({ code: 'RELATIONSHIP_ACTIVE' });
  });

  it('accepts escalation-only access without silently granting board oversight', async () => {
    const { customer, actor, review, input } = await readyForAcceptance('escalation_only');
    expect(review.scope).toMatchObject({ visibilityMode: 'escalation_only', boards: [], projects: [], delegatedAdministration: [] });
    await acceptCoManagedRelationship(db, actor, input);
    expect(await customer.table('co_management_board_scopes')).toHaveLength(0);
  });

  it('denies the sponsor, sibling customers, and a guessed relationship identity', async () => {
    const a = await readyForAcceptance(), b = await readyForAcceptance();
    await expect(acceptCoManagedRelationship(db, { tenant: a.operation.tenant, userId: a.operation.requested_by }, a.input))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(acceptCoManagedRelationship(db, b.actor, a.input)).rejects.toMatchObject({ code: 'NOT_PENDING' });
    await expect(acceptCoManagedRelationship(db, a.actor, { ...a.input, relationshipId: randomUUID() })).rejects.toMatchObject({ code: 'NOT_PENDING' });
    expect(await a.customer.table('co_management_relationship_events')).toHaveLength(0);
  });

  it('rechecks permissions and active internal identity instead of trusting an earlier review', async () => {
    const { customer, actor, input } = await readyForAcceptance();
    await customer.table('user_roles').where('user_id', actor.userId).del();
    expect(await getCoManagedAcceptanceState(db, actor)).toMatchObject({ canAccept: false });
    await expect(acceptCoManagedRelationship(db, actor, input)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await customer.table('users').where('user_id', actor.userId).update({ is_inactive: true });
    await expect(getCoManagedAcceptanceState(db, actor)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rejects stale revisions and edited scopes even without a revision advance', async () => {
    const { customer, actor, input } = await readyForAcceptance();
    await expect(acceptCoManagedRelationship(db, actor, { ...input, revision: 2 })).rejects.toMatchObject({ code: 'SCOPE_CHANGED' });
    await customer.table('co_management_board_scopes').update({ can_collaborate: false });
    await expect(acceptCoManagedRelationship(db, actor, input)).rejects.toMatchObject({ code: 'SCOPE_CHANGED' });
    const next = await getCoManagedAcceptanceState(db, actor);
    expect(next).toMatchObject({ scope: { boards: [expect.objectContaining({ canCollaborate: false })] } });
    if (next.state !== 'pending_acceptance') throw new Error('Expected pending');
    await acceptCoManagedRelationship(db, actor, { ...input, scopeFingerprint: next.scopeFingerprint });
  });

  it('leaves seats reserved when activation is denied during a capacity lapse', async () => {
    const { operation, customer, actor, input } = await readyForAcceptance();
    const sponsor = tenantDb(db, operation.tenant);
    await sponsor.table('co_managed_entitlements').update({ valid_until: new Date(0) });
    await expect(acceptCoManagedRelationship(db, actor, input)).rejects.toMatchObject({ code: 'CAPACITY_UNAVAILABLE' });
    expect(await sponsor.table('co_managed_allocations').first()).toMatchObject({ state: 'reserved' });
    expect(await customer.table('co_management_relationship_events')).toHaveLength(0);
  });

  it('serializes acceptance against cancellation so only one may win', async () => {
    const { operation, customer, actor, input } = await readyForAcceptance();
    const results = await Promise.allSettled([acceptCoManagedRelationship(db, actor, input),
      requestCoManagedProvisioningCleanup(db, operation.tenant, operation.operation_id)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const relationship = await customer.table('co_management_relationships').first();
    const stored = await tenantDb(db, operation.tenant).table('co_managed_provisioning_operations').first();
    if (relationship.state === 'active') expect(stored.state).toBe('pending_acceptance');
    else expect(stored.state).toBe('cleanup_requested');
  });
});

async function createCustomerTechnician(tenant: string, email = `technician-${randomUUID()}@example.test`) {
  return db.transaction(async trx => {
    await assertCoManagedSeatAdmission(trx, tenant, { email });
    const [user] = await tenantDb(trx, tenant).table('users').insert({ tenant, user_id: randomUUID(), username: email, email,
      first_name: 'Technician', last_name: 'Test', hashed_password: 'not-a-login', user_type: 'internal', is_inactive: false }).returning('*');
    return user;
  });
}
async function reserveCustomerInvitation(tenant: string, email: string) {
  return db.transaction(async trx => {
    await assertCoManagedSeatAdmission(trx, tenant, { email, kind: 'invitation' });
    const role = await tenantDb(trx, tenant).table('roles').where({ role_name: 'Technician', msp: true }).first();
    await tenantDb(trx, tenant).table('user_invitations').insert({ tenant, invitation_id: randomUUID(), email,
      first_name: 'Invited', last_name: 'Tech', role_id: role.role_id, token: randomUUID(), expires_at: trx.raw("now() + interval '24 hours'"), metadata: {} });
  });
}

describe('customer technician allocation admission', () => {
  it('serializes concurrent last-seat creates without using MSP licensed_user_count', async () => {
    const { operation, customer, actor, input } = await readyForAcceptance();
    await acceptCoManagedRelationship(db, actor, input);
    await tenantDb(db, operation.tenant).table('tenants').update({ licensed_user_count: 0 });
    const results = await Promise.allSettled([createCustomerTechnician(actor.tenant), createCustomerTechnician(actor.tenant)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(await customer.table('users').where({ user_type: 'internal', is_inactive: false })).toHaveLength(2);
  });
  it('reserves invitation capacity against direct creates and concurrent other invitations', async () => {
    const { actor, input } = await readyForAcceptance();
    await acceptCoManagedRelationship(db, actor, input);
    const results = await Promise.allSettled([reserveCustomerInvitation(actor.tenant, 'one@example.test'), reserveCustomerInvitation(actor.tenant, 'two@example.test')]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    await expect(createCustomerTechnician(actor.tenant)).rejects.toMatchObject({ code: 'CO_MANAGED_SEAT_LIMIT' });
    expect(await db.transaction(trx => countCoManagedCommittedSeats(trx, actor.tenant))).toBe(2);
  });
  it('does not charge requesters or expired invitations as technician seats', async () => {
    const { customer, actor, input } = await readyForAcceptance();
    await acceptCoManagedRelationship(db, actor, input);
    await reserveCustomerInvitation(actor.tenant, 'expired@example.test');
    await customer.table('user_invitations').where('email', 'expired@example.test').update({ expires_at: new Date(0) });
    await customer.table('users').insert({ tenant: actor.tenant, user_id: randomUUID(), username: 'requester', email: 'requester@example.test',
      first_name: 'Requester', last_name: 'Test', hashed_password: 'not-a-login', user_type: 'client', is_inactive: false });
    await expect(createCustomerTechnician(actor.tenant)).resolves.toMatchObject({ user_type: 'internal' });
  });
  it('requires the original administrator invitation before activation', async () => {
    const operation = await prepare(); await bootstrapCoManagedWorkspace(db, operation.tenant, operation.operation_id, log);
    const customer = tenantDb(db, operation.customer_tenant), invitation = await customer.table('user_invitations').first();
    await expect(createCustomerTechnician(operation.customer_tenant, invitation.email)).rejects.toMatchObject({ code: 'CO_MANAGED_NOT_ACTIVE' });
    await expect(db.transaction(trx => assertCoManagedSeatAdmission(trx, operation.customer_tenant, { email: invitation.email, invitationToken: 'wrong-token' })))
      .rejects.toMatchObject({ code: 'CO_MANAGED_INVITATION_INVALID' });
    expect(await db.transaction(trx => assertCoManagedSeatAdmission(trx, operation.customer_tenant, { email: invitation.email, invitationToken: invitation.token })))
      .toMatchObject({ managed: true, invitation: { invitation_id: invitation.invitation_id } });
  });
  it('blocks growth immediately on lapse, including consuming an already-issued invitation', async () => {
    const { operation, actor, input } = await readyForAcceptance(); await acceptCoManagedRelationship(db, actor, input);
    await reserveCustomerInvitation(actor.tenant, 'pending@example.test');
    await tenantDb(db, operation.tenant).table('co_managed_entitlements').update({ valid_until: new Date(0) });
    await expect(createCustomerTechnician(actor.tenant, 'pending@example.test')).rejects.toMatchObject({ code: 'CO_MANAGED_LICENSE_LAPSED' });
  });
  it('serializes reactivation with a new last-seat account and tolerates repeated activation of the winner', async () => {
    const { customer, actor, input } = await readyForAcceptance(); await acceptCoManagedRelationship(db, actor, input);
    const inactiveId = randomUUID();
    await customer.table('users').insert({ tenant: actor.tenant, user_id: inactiveId, username: 'inactive', email: 'inactive@example.test',
      first_name: 'Inactive', last_name: 'Test', hashed_password: 'not-a-login', user_type: 'internal', is_inactive: true });
    const reactivate = () => db.transaction(async trx => {
      await assertCoManagedSeatAdmission(trx, actor.tenant, { email: 'inactive@example.test', existingUserId: inactiveId });
      await tenantDb(trx, actor.tenant).table('users').where('user_id', inactiveId).update({ is_inactive: false });
    });
    const results = await Promise.allSettled([reactivate(), createCustomerTechnician(actor.tenant)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(await customer.table('users').where({ user_type: 'internal', is_inactive: false })).toHaveLength(2);
    if (results[0].status === 'fulfilled') await expect(reactivate()).resolves.toBeUndefined();
  });
  it('never shrinks below committed seats or evicts users; a concurrent shrink/create cannot oversubscribe', async () => {
    const { operation, customer, actor, input } = await readyForAcceptance(); await acceptCoManagedRelationship(db, actor, input);
    const change = { customerTenant: actor.tenant, relationshipId: input.relationshipId, seats: 1, expectedSeats: 2 };
    const results = await Promise.allSettled([changeCoManagedAllocation(db, operation.tenant, change), createCustomerTechnician(actor.tenant)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const allocated = await tenantDb(db, operation.tenant).table('co_managed_allocations').first();
    const count = await db.transaction(trx => countCoManagedCommittedSeats(trx, actor.tenant));
    expect(count).toBeLessThanOrEqual(allocated.seats);
    expect((await customer.table('tenants').first()).licensed_user_count).toBe(allocated.seats);
    expect(await customer.table('users').where('is_inactive', true)).toHaveLength(0);
    await expect(changeCoManagedAllocation(db, randomUUID(), change)).rejects.toMatchObject({ code: 'CO_MANAGED_ALLOCATION_CONFLICT' });
  });
});

async function userServiceForTest() {
  // Keep the real admission, transaction, account, role, preferences, and token
  // writes. Only authentication (covered by action tests) and presentation
  // enrichment are replaced; no service connection may reach the source DB.
  const { UserService } = await import('../../../../packages/users/src/services/UserService');
  const service = new UserService();
  vi.spyOn(service as any, 'ensurePermission').mockResolvedValue(undefined);
  vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: db });
  vi.spyOn(service as any, 'enhanceUsersWithDetails').mockImplementation(async (rows: unknown) => rows);
  return service;
}

describe('real user service with co-managed allocation admission', () => {
  it('creates the initial administrator from its token exactly once, with role and token consumption in the same transaction', async () => {
    const operation = await prepare(); await bootstrapCoManagedWorkspace(db, operation.tenant, operation.operation_id, log);
    const customer = tenantDb(db, operation.customer_tenant), invitation = await customer.table('user_invitations').first();
    const service = await userServiceForTest(), context = { tenant: operation.customer_tenant, userId: randomUUID() };
    const results = await runWithTenant(operation.customer_tenant, () => Promise.allSettled([
      service.createFromInvitation(invitation.token, 'Testing-strong-password-42!', context),
      service.createFromInvitation(invitation.token, 'Different-password-must-not-reset-42!', context),
    ]));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const users = await customer.table('users'); expect(users).toHaveLength(1);
    expect(await customer.table('user_roles')).toEqual([expect.objectContaining({ user_id: users[0].user_id, role_id: invitation.role_id })]);
    expect((await customer.table('user_invitations').first()).used_at).not.toBeNull();
    expect((await customer.table('co_management_relationships').first()).state).toBe('pending_acceptance');
  });
  it('rolls back the account and keeps the invitation usable if a required account write fails', async () => {
    const operation = await prepare(); await bootstrapCoManagedWorkspace(db, operation.tenant, operation.operation_id, log);
    const customer = tenantDb(db, operation.customer_tenant), invitation = await customer.table('user_invitations').first();
    const service = await userServiceForTest(), context = { tenant: operation.customer_tenant, userId: randomUUID() };
    const fail = vi.spyOn(service as any, 'createDefaultUserPreferences').mockRejectedValueOnce(new Error('Simulated account write failure'));
    await expect(runWithTenant(operation.customer_tenant, () => service.createFromInvitation(invitation.token, 'Testing-strong-password-42!', context)))
      .rejects.toThrow('Simulated account write failure');
    expect(await customer.table('users')).toHaveLength(0); expect(await customer.table('user_roles')).toHaveLength(0);
    expect((await customer.table('user_invitations').first()).used_at).toBeNull();
    fail.mockRestore();
    await runWithTenant(operation.customer_tenant, () => service.createFromInvitation(invitation.token, 'Testing-strong-password-42!', context));
    expect(await customer.table('users')).toHaveLength(1);
  });
  it('prevents API creation from taking a seat already reserved by another invitation', async () => {
    const { customer, actor, input } = await readyForAcceptance(); await acceptCoManagedRelationship(db, actor, input);
    await reserveCustomerInvitation(actor.tenant, 'invited-service@example.test');
    const service = await userServiceForTest(), context = { tenant: actor.tenant, userId: actor.userId };
    await expect(runWithTenant(actor.tenant, () => service.create({ username: 'direct-api', email: 'direct-api@example.test',
      password: 'Testing-strong-password-42!', user_type: 'internal' }, context))).rejects.toThrow('allocation is full');
    const invitation = await customer.table('user_invitations').where('email', 'invited-service@example.test').first();
    await runWithTenant(actor.tenant, () => service.createFromInvitation(invitation.token, 'Testing-strong-password-42!', context));
    expect(await customer.table('users')).toHaveLength(2);
  });
});

describe('co-managed directory reactivation', () => {
  it('keeps a directory-deactivated user inactive when another technician has taken the available seat', async () => {
    const { customer, actor, input } = await readyForAcceptance(); await acceptCoManagedRelationship(db, actor, input);
    const linked = await createCustomerTechnician(actor.tenant, 'directory-tech@example.test');
    const [connection] = await customer.table('scim_connections').insert({ tenant: actor.tenant, enabled: true,
      current_token_generation: 1, created_at: new Date(), updated_at: new Date() }).returning('*');
    const { ScimProvisioningService } = await import('../../../../ee/server/src/lib/scim/service');
    const service = new ScimProvisioningService(db, connection, 'https://example.test/scim');
    const resource = await service.createUser({ externalId: randomUUID(), userName: linked.email, primaryEmail: linked.email,
      active: true, displayName: 'Directory Tech', givenName: 'Directory', familyName: 'Tech', title: null });
    await service.patchUser(String(resource.id), [{ op: 'replace', path: 'active', value: false }]);
    await createCustomerTechnician(actor.tenant);
    await expect(service.patchUser(String(resource.id), [{ op: 'replace', path: 'active', value: true }])).rejects.toThrow('allocation is full');
    expect(await customer.table('users').where('user_id', linked.user_id).first()).toMatchObject({ is_inactive: true });
  });
});

it('grows an allocation only from available verified capacity and rejects stale resize attempts', async () => {
  const { operation, customer, actor, input } = await readyForAcceptance(); await acceptCoManagedRelationship(db, actor, input);
  const grow = { customerTenant: actor.tenant, relationshipId: input.relationshipId, seats: 3, expectedSeats: 2 };
  await expect(changeCoManagedAllocation(db, operation.tenant, grow)).rejects.toMatchObject({ code: 'CO_MANAGED_POOL_LIMIT' });
  const sponsor = tenantDb(db, operation.tenant);
  await sponsor.table('co_managed_entitlements').update({ capacity: 4 });
  await changeCoManagedAllocation(db, operation.tenant, grow);
  expect((await customer.table('tenants').first()).licensed_user_count).toBe(3);
  await expect(changeCoManagedAllocation(db, operation.tenant, { ...grow, seats: 4 })).rejects.toMatchObject({ code: 'CO_MANAGED_ALLOCATION_CONFLICT' });
  await sponsor.table('co_managed_purchase_operations').insert({ tenant: operation.tenant, operation_id: randomUUID(), quantity: 4, state: 'preparing' });
  await expect(changeCoManagedAllocation(db, operation.tenant, { ...grow, seats: 4, expectedSeats: 3 })).rejects.toMatchObject({ code: 'CO_MANAGED_ALLOCATION_CONFLICT' });
});

describe('transactional operational lifecycle admission', () => {
  const rename = (tenant: string, name: string) => withCoManagedOperationalTransaction(db, tenant,
    trx => tenantDb(trx, tenant).table('boards').update({ board_name: name }));

  it('requires acceptance even for an administrator with capacity, then permits operational writes', async () => {
    const { customer, actor, input } = await readyForAcceptance();
    expect(await getCoManagedOperationalState(db, actor.tenant)).toEqual({ state: 'pending_acceptance', canWrite: false, graceEndsAt: null });
    await expect(rename(actor.tenant, 'Must not write')).rejects.toMatchObject({ code: 'CO_MANAGED_NOT_ACTIVE' });
    expect((await customer.table('boards').first()).board_name).toBe('Service Desk');
    await acceptCoManagedRelationship(db, actor, input);
    await rename(actor.tenant, 'Customer Operations');
    expect((await customer.table('boards').first()).board_name).toBe('Customer Operations');
  });

  it('allows existing operations during the fixed grace interval but blocks growth immediately', async () => {
    const { operation, actor, input } = await readyForAcceptance(); await acceptCoManagedRelationship(db, actor, input);
    const expired = new Date(Date.now() - 86_400_000);
    await tenantDb(db, operation.tenant).table('co_managed_entitlements').update({ valid_until: expired });
    const state = await getCoManagedOperationalState(db, actor.tenant);
    expect(state).toEqual({ state: 'grace', canWrite: true, graceEndsAt: new Date(expired.getTime() + 30 * 86_400_000).toISOString() });
    await rename(actor.tenant, 'Still operating during grace');
    await expect(createCustomerTechnician(actor.tenant)).rejects.toMatchObject({ code: 'CO_MANAGED_LICENSE_LAPSED' });
    expect(await getCoManagedOperationalState(db, actor.tenant)).toEqual(state);
  });

  it('enforces expiration without a webhook or scheduled job, and permits reads', async () => {
    const { operation, customer, actor, input } = await readyForAcceptance(); await acceptCoManagedRelationship(db, actor, input);
    const expired = new Date(Date.now() - 31 * 86_400_000);
    await tenantDb(db, operation.tenant).table('co_managed_entitlements').update({ valid_until: expired });
    await expect(rename(actor.tenant, 'Forbidden late change')).rejects.toMatchObject({ code: 'CO_MANAGED_READ_ONLY' });
    expect((await customer.table('boards').first()).board_name).toBe('Service Desk');
    expect(await customer.table('users')).toHaveLength(1);
    expect(await getCoManagedOperationalState(db, actor.tenant)).toEqual({ state: 'read_only', canWrite: false,
      graceEndsAt: new Date(expired.getTime() + 30 * 86_400_000).toISOString() });
  });

  it('renews the original relationship without repeating activation or provisioning', async () => {
    const { operation, customer, actor, input } = await readyForAcceptance(); await acceptCoManagedRelationship(db, actor, input);
    const sponsor = tenantDb(db, operation.tenant);
    await sponsor.table('co_managed_entitlements').update({ valid_until: new Date(0) });
    expect((await getCoManagedOperationalState(db, actor.tenant)).state).toBe('read_only');
    const entitlement = await sponsor.table('co_managed_entitlements').first();
    await reconcileHostedCoManagedEntitlement(db, operation.tenant, entitlement.source_reference,
      async () => ({ active: true, capacity: 2, validUntil: new Date(Date.now() + 86_400_000) }));
    expect(await getCoManagedOperationalState(db, actor.tenant)).toEqual({ state: 'active', canWrite: true, graceEndsAt: null });
    await rename(actor.tenant, 'Renewed');
    expect(await customer.table('co_management_relationship_events')).toHaveLength(1);
    expect(await customer.table('users')).toHaveLength(1);
  });

  it('starts a durable grace on loss of sponsor Pro eligibility with a current seat subscription', async () => {
    const { operation, actor, input } = await readyForAcceptance(); await acceptCoManagedRelationship(db, actor, input);
    const sponsor = tenantDb(db, operation.tenant);
    await sponsor.table('tenants').update({ plan: 'essentials' });
    const first = await getCoManagedOperationalState(db, actor.tenant);
    expect(first).toMatchObject({ state: 'grace', canWrite: true });
    expect(first.graceEndsAt).not.toBeNull();
    expect(await getCoManagedOperationalState(db, actor.tenant)).toEqual(first);
    const lapse = new Date(Date.now() - 31 * 86_400_000);
    await sponsor.table('co_managed_entitlements').update({ lapse_started_at: lapse,
      read_only_after: new Date(lapse.getTime() + 30 * 86_400_000) });
    await expect(rename(actor.tenant, 'Ineligible sponsor')).rejects.toMatchObject({ code: 'CO_MANAGED_READ_ONLY' });
    await sponsor.table('tenants').update({ plan: 'pro' });
    expect((await getCoManagedOperationalState(db, actor.tenant)).state).toBe('active');
  });

  it('denies ended trust and never treats a missing active allocation as an independent workspace', async () => {
    const a = await readyForAcceptance(), b = await readyForAcceptance();
    await acceptCoManagedRelationship(db, a.actor, a.input); await acceptCoManagedRelationship(db, b.actor, b.input);
    await a.customer.table('co_management_relationships').update({ state: 'terminated', ended_at: new Date() });
    await expect(rename(a.actor.tenant, 'Terminated')).rejects.toMatchObject({ code: 'CO_MANAGED_READ_ONLY' });
    await tenantDb(db, b.operation.tenant).table('co_managed_allocations').update({ state: 'released', released_at: new Date() });
    await expect(rename(b.actor.tenant, 'No allocation')).rejects.toMatchObject({ code: 'CO_MANAGED_READ_ONLY' });
    expect((await getCoManagedOperationalState(db, a.actor.tenant)).state).toBe('terminated');
    expect((await getCoManagedOperationalState(db, b.actor.tenant)).state).toBe('read_only');
  });

  it('rechecks committed license state after waiting for the sponsor lock', async () => {
    const { operation, customer, actor, input } = await readyForAcceptance(); await acceptCoManagedRelationship(db, actor, input);
    const blocker = await db.transaction();
    await tenantDb(blocker, operation.tenant).table('co_managed_entitlements').update({ valid_until: new Date(0) });
    let onQuery: (query: { sql: string }) => void;
    const waiting = new Promise<void>(resolve => {
      onQuery = query => { if (query.sql.includes('co_managed_entitlements') && query.sql.includes('for update')) resolve(); };
      db.on('query', onQuery);
    });
    const attempt = rename(actor.tenant, 'Stale license').then(() => null, error => error);
    try {
      await waiting;
      await blocker.commit();
      expect(await attempt).toMatchObject({ code: 'CO_MANAGED_READ_ONLY' });
      expect((await customer.table('boards').first()).board_name).toBe('Service Desk');
    } finally {
      db.removeListener('query', onQuery!);
      if (!blocker.isCompleted()) await blocker.rollback();
    }
  });

  it('keeps a nested caller transaction intact and rolls back its operational changes', async () => {
    const { customer, actor, input } = await readyForAcceptance(); await acceptCoManagedRelationship(db, actor, input);
    await expect(db.transaction(async trx => {
      await withCoManagedOperationalTransaction(trx, actor.tenant, async same => {
        expect(same).toBe(trx);
        await tenantDb(same, actor.tenant).table('boards').update({ board_name: 'Uncommitted' });
      });
      throw new Error('Abort outer operation');
    })).rejects.toThrow('Abort outer operation');
    expect((await customer.table('boards').first()).board_name).toBe('Service Desk');
    await expect(assertCoManagedOperationalWrite(db as Knex.Transaction, actor.tenant)).rejects.toThrow('open transaction');
  });

  it('leaves ordinary PSA operations available and fails closed for nonexistent tenants', async () => {
    const operation = await prepare();
    expect(await getCoManagedOperationalState(db, operation.tenant)).toEqual({ state: 'independent', canWrite: true, graceEndsAt: null });
    await rename(operation.tenant, 'MSP operations');
    await expect(rename(randomUUID(), 'Unknown tenant')).rejects.toThrow('does not exist');
  });
});

async function ticketServiceForTest() {
  const { TicketService } = await import('../../lib/api/services/TicketService');
  const service = new TicketService();
  vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: db });
  const publish = vi.spyOn(service as any, 'safePublishEvent').mockResolvedValue(undefined);
  return { service, publish };
}

describe('ticket API lifecycle admission against PostgreSQL', () => {
  it('denies direct ticket, assignment, comment, and bundle mutations before acceptance and after grace', async () => {
    const { operation, customer, actor, input } = await readyForAcceptance();
    const { service, publish } = await ticketServiceForTest();
    const context = { tenant: actor.tenant, userId: actor.userId };
    const ticketId = randomUUID(), secondId = randomUUID();
    const data = { title: 'Direct API ticket', client_id: operation.customer_client_id,
      board_id: operation.customer_board_id, status_id: randomUUID(), priority_id: randomUUID() };
    const operations = [
      () => service.create(data, context),
      () => service.update(ticketId, { title: 'Changed' }, context),
      () => service.delete(ticketId, context),
      () => service.bulkCreate([{}], context),
      () => service.bulkUpdate([{ id: ticketId, data: { title: 'Bypass attempt' } }], context),
      () => service.bulkDelete([ticketId], context),
      () => service.linkAsset(ticketId, { asset_id: secondId }, context),
      () => service.unlinkAsset(ticketId, secondId, context),
      () => service.deleteTicketDocument(ticketId, secondId, context),
      () => service.createFromAsset({ ...data, asset_id: secondId, description: '' }, context),
      () => service.addTicketAgent(ticketId, { user_id: secondId }, context),
      () => service.removeTicketAgent(ticketId, secondId, context),
      () => service.assignTeam(ticketId, { team_id: secondId }, context),
      () => service.removeTeam(ticketId, { mode: 'remove_all' }, context),
      () => service.addComment(ticketId, { comment_text: 'Should not write' }, context),
      () => service.updateComment(ticketId, secondId, { comment_text: 'Should not edit' }, context),
      () => service.bundleTickets(context, { masterTicketId: ticketId, childTicketIds: [secondId], mode: 'sync_updates' }),
      () => service.addBundleChildren(context, { masterTicketId: ticketId, childTicketIds: [secondId] }),
      () => service.promoteBundleMaster(context, { oldMasterTicketId: ticketId, newMasterTicketId: secondId }),
      () => service.updateBundleSettings(context, { masterTicketId: ticketId, reopenOnChildReply: true }),
      () => service.removeBundleChild(context, { childTicketId: ticketId }),
      () => service.unbundleMaster(context, { masterTicketId: ticketId }),
    ];
    for (const mutate of operations) await expect(mutate()).rejects.toMatchObject({ code: 'CO_MANAGED_NOT_ACTIVE' });
    await acceptCoManagedRelationship(db, actor, input);
    await tenantDb(db, operation.tenant).table('co_managed_entitlements').update({ valid_until: new Date(0) });
    for (const mutate of operations) await expect(mutate()).rejects.toMatchObject({ code: 'CO_MANAGED_READ_ONLY' });
    expect(await customer.table('tickets')).toHaveLength(0);
    expect(await customer.table('comments')).toHaveLength(0);
    expect(await customer.table('ticket_bundle_settings')).toHaveLength(0);
    expect(publish).not.toHaveBeenCalled();
  });

  it('creates and edits a canonical ticket during active/grace states, preserves reads after expiry, and returns actionable API errors', async () => {
    const { operation, customer, actor, input } = await readyForAcceptance(); await acceptCoManagedRelationship(db, actor, input);
    const { service } = await ticketServiceForTest(), context = { tenant: actor.tenant, userId: actor.userId };
    const status = await customer.table('statuses').where({ board_id: operation.customer_board_id, item_type: 'ticket' }).first();
    const priority = await customer.table('priorities').where({ item_type: 'ticket' }).first();
    const ticket = await service.create({ title: 'Working ticket', description: 'Customer work', client_id: operation.customer_client_id,
      board_id: operation.customer_board_id, status_id: status.status_id, priority_id: priority.priority_id }, context);
    await tenantDb(db, operation.tenant).table('co_managed_entitlements').update({ valid_until: new Date(Date.now() - 86_400_000) });
    await service.update(ticket.ticket_id, { title: 'Edited during grace' }, context);
    const lapse = new Date(Date.now() - 31 * 86_400_000);
    await tenantDb(db, operation.tenant).table('co_managed_entitlements').update({ valid_until: lapse, lapse_started_at: lapse,
      read_only_after: new Date(lapse.getTime() + 30 * 86_400_000) });
    const { handleApiError } = await import('../../lib/api/middleware/apiMiddleware');
    const error = await service.update(ticket.ticket_id, { title: 'Forbidden change' }, context).then(() => null, error => error);
    const response = handleApiError(error);
    expect(response.status).toBe(423);
    expect(await response.json()).toMatchObject({ error: { code: 'CO_MANAGED_READ_ONLY' } });
    expect((await customer.table('tickets').where('ticket_id', ticket.ticket_id).first()).title).toBe('Edited during grace');
    expect(await service.getTicketAgents(ticket.ticket_id, context)).toMatchObject({ ticket_id: ticket.ticket_id });
  });
});

async function stagedCoManagedInbox(tenant: string) {
  const { upsertInbox, upsertIngress } = await import('../../../../shared/services/email/inboundEmailDurableStore');
  const provider = randomUUID(), identity = randomUUID();
  await tenantDb(db, tenant).table('email_providers').insert({ tenant, id: provider, provider_type: 'google',
    provider_name: 'Customer Mail', mailbox: 'helpdesk@example.test', is_active: true, status: 'connected' });
  const ingress = await upsertIngress(db, { tenant, provider_id: provider, provider_type: 'google',
    ingress_key: identity, provider_pointer: { messageId: identity } });
  return upsertInbox(db, { tenant, ingress_id: ingress.ingress_id, provider_id: provider, provider_type: 'google',
    normalized_message_id: identity, provider_message_id: identity, rfc_message_id: `<${identity}@example.test>`,
    source_object_key: `test/${identity}.eml`, source_sha256: 'a'.repeat(64), source_size_bytes: 40,
    source_staged_at: new Date(), envelope: { subject: 'Retained customer request' } });
}

async function runCoManagedInbox(tenantId: string, inboxId: string) {
  const { processInboundInbox } = await import('../../../../shared/services/email/inboundEmailCoreProcessor');
  return processInboundInbox({ tenantId, inboxId, owner: randomUUID(), leaseTtlMs: 30_000, mode: 'enforce' });
}

describe('durable co-managed email intake pauses', () => {
  it('retains pending and expired-workspace mail without source fetches, processing attempts, or terminal acknowledgements', async () => {
    const { operation, actor, customer, input } = await readyForAcceptance();
    const inbox = await stagedCoManagedInbox(actor.tenant);
    intake.read.mockReset(); intake.process.mockReset();
    for (let i = 0; i < 7; i++) {
      expect(await runCoManagedInbox(actor.tenant, inbox.inbox_id)).toMatchObject({ disposition: 'defer', reason: 'co_managed_pending_acceptance' });
    }
    let row = await customer.table('inbound_email_inbox').first();
    expect(row).toMatchObject({ status: 'received', attempt_count: 0, source_object_key: inbox.source_object_key,
      source_sha256: inbox.source_sha256, completed_at: null, error_details: { co_managed_lifecycle: { state: 'pending_acceptance' } } });
    const { findDueInbox, claimInbox } = await import('../../../../shared/services/email/inboundEmailDurableStore');
    expect(await findDueInbox(db, { tenant: actor.tenant })).toHaveLength(0);
    expect(await claimInbox(db, { tenant: actor.tenant, inbox_id: inbox.inbox_id, owner: 'not-due', leaseTtlMs: 30_000 }))
      .toEqual({ claimed: false, reason: 'not_due' });
    await acceptCoManagedRelationship(db, actor, input);
    await tenantDb(db, operation.tenant).table('co_managed_entitlements').update({ valid_until: new Date(0) });
    expect(await runCoManagedInbox(actor.tenant, inbox.inbox_id)).toMatchObject({ disposition: 'defer', reason: 'co_managed_read_only' });
    row = await customer.table('inbound_email_inbox').first();
    expect(row).toMatchObject({ status: 'received', attempt_count: 0, completed_at: null });
    expect(intake.read).not.toHaveBeenCalled(); expect(intake.process).not.toHaveBeenCalled();
    expect(await customer.table('inbound_email_effects')).toHaveLength(0);
  });

  it('refunds the claim when grace expires during source fetch and resumes the same inbox exactly once after renewal', async () => {
    const { operation, actor, customer, input } = await readyForAcceptance(); await acceptCoManagedRelationship(db, actor, input);
    const inbox = await stagedCoManagedInbox(actor.tenant), sponsor = tenantDb(db, operation.tenant);
    intake.process.mockReset(); intake.parse.mockReset(); intake.read.mockReset();
    intake.read.mockImplementationOnce(async () => {
      await sponsor.table('co_managed_entitlements').update({ valid_until: new Date(0) });
      return Buffer.from('retained source');
    });
    intake.parse.mockResolvedValue({ emailData: { id: inbox.provider_message_id, tenant: actor.tenant,
      subject: 'Retained request', body: { text: 'Please help' }, attachments: [] } });
    expect(await runCoManagedInbox(actor.tenant, inbox.inbox_id)).toMatchObject({ disposition: 'defer', reason: 'co_managed_read_only' });
    expect(await customer.table('inbound_email_inbox').first()).toMatchObject({ status: 'received', attempt_count: 0,
      lease_owner: null, lease_token: null, completed_at: null });
    expect(intake.process).not.toHaveBeenCalled();
    const entitlement = await sponsor.table('co_managed_entitlements').first();
    await reconcileHostedCoManagedEntitlement(db, operation.tenant, entitlement.source_reference,
      async () => ({ active: true, capacity: 2, validUntil: new Date(Date.now() + 3600000) }));
    // Advance only this disposable record's scheduled wakeup, without sleeping.
    await customer.table('inbound_email_inbox').update({ next_attempt_at: new Date(0) });
    intake.read.mockResolvedValue(Buffer.from('same retained source'));
    let ticketId: string, commentId: string;
    // Substitute only sender/routing policy. Canonical ticket/comment writes,
    // transactional outbox, effects, and terminal inbox state all remain real.
    intake.process.mockImplementationOnce(async (_input, options) => {
      const trx = options.durableExecution.trx;
      const { TicketModel } = await import('../../../../shared/models/ticketModel');
      const scoped = tenantDb(trx, actor.tenant);
      const status = await scoped.table('statuses').where({ board_id: operation.customer_board_id, item_type: 'ticket' }).first();
      const priority = await scoped.table('priorities').where({ item_type: 'ticket' }).first();
      const ticket = await TicketModel.createTicket({ title: 'Retained request', description: 'Please help', source: 'email',
        client_id: operation.customer_client_id, board_id: operation.customer_board_id, status_id: status.status_id,
        priority_id: priority.priority_id, entered_by: actor.userId }, actor.tenant, trx, {},
        options.durableExecution.eventPublishers.ticket, undefined, actor.userId);
      const comment = await TicketModel.createComment({ ticket_id: ticket.ticket_id, content: 'Please help',
        author_type: 'internal', author_id: actor.userId }, actor.tenant, trx,
        options.durableExecution.eventPublishers.comment, undefined, actor.userId);
      ticketId = ticket.ticket_id; commentId = comment.comment_id;
      return { outcome: 'created', ticketId, commentId };
    });
    const processed = await runCoManagedInbox(actor.tenant, inbox.inbox_id);
    expect(processed).toMatchObject({ disposition: 'ack', outcome: 'created', ticketId: ticketId!, commentId: commentId! });
    expect(await customer.table('inbound_email_inbox').first()).toMatchObject({ status: 'succeeded', attempt_count: 1 });
    expect(await customer.table('inbound_email_effects')).toHaveLength(2);
    expect(await customer.table('tickets')).toEqual([expect.objectContaining({ ticket_id: ticketId!, title: 'Retained request' })]);
    expect(await customer.table('comments')).toEqual([expect.objectContaining({ comment_id: commentId!, ticket_id: ticketId! })]);
    const outbox = await customer.table('inbound_email_outbox');
    expect(outbox.length).toBeGreaterThan(0);
    // Another lapse cannot make a completed message execute again.
    await sponsor.table('co_managed_entitlements').update({ valid_until: new Date(0) });
    expect(await runCoManagedInbox(actor.tenant, inbox.inbox_id)).toMatchObject({ disposition: 'ack', reason: 'terminal_replay' });
    expect(intake.process).toHaveBeenCalledTimes(1);
    expect(await customer.table('tickets')).toHaveLength(1);
    expect(await customer.table('comments')).toHaveLength(1);
    expect(await customer.table('inbound_email_outbox')).toHaveLength(outbox.length);
  });

  it('does not release another worker lease or refund a reclaimed attempt, and preserves prior error provenance', async () => {
    const { actor, customer } = await readyForAcceptance(), inbox = await stagedCoManagedInbox(actor.tenant);
    const { claimInbox, reclaimInbox, deferInboxForCoManagedLifecycle } = await import('../../../../shared/services/email/inboundEmailDurableStore');
    const initial = await claimInbox(db, { tenant: actor.tenant, inbox_id: inbox.inbox_id, owner: 'first', leaseTtlMs: 30000 });
    if (!initial.claimed) throw new Error('Expected first claim');
    await customer.table('inbound_email_inbox').update({ lease_expires_at: new Date(0), last_error: 'earlier source failure', error_details: { diagnostic: 'preserve' } });
    const reclaimed = await reclaimInbox(db, { tenant: actor.tenant, inbox_id: inbox.inbox_id, owner: 'second', leaseTtlMs: 30000 });
    if (!reclaimed.claimed) throw new Error('Expected reclaim');
    const pause = { tenant: actor.tenant, inboxId: inbox.inbox_id, state: 'pending_acceptance' as const, until: new Date(Date.now() + 60000) };
    expect(await deferInboxForCoManagedLifecycle(db, { ...pause, claim: { owner: 'first', token: initial.row.lease_token!,
      version: initial.row.lease_version, refundAttempt: true } })).toBe(false);
    expect(await deferInboxForCoManagedLifecycle(db, { ...pause, claim: { owner: 'second', token: reclaimed.row.lease_token!,
      version: reclaimed.row.lease_version, refundAttempt: false } })).toBe(true);
    expect(await customer.table('inbound_email_inbox').first()).toMatchObject({ status: 'received', attempt_count: 1,
      last_error: 'earlier source failure', error_details: { diagnostic: 'preserve', co_managed_lifecycle: { state: 'pending_acceptance' } } });
  });
});

async function withInboundMode<T>(mode: string, work: () => Promise<T>): Promise<T> {
  const previous = process.env.UNIFIED_INBOUND_EMAIL_DURABLE_MODE;
  process.env.UNIFIED_INBOUND_EMAIL_DURABLE_MODE = mode;
  try { return await work(); }
  finally {
    if (previous === undefined) delete process.env.UNIFIED_INBOUND_EMAIL_DURABLE_MODE;
    else process.env.UNIFIED_INBOUND_EMAIL_DURABLE_MODE = previous;
  }
}

describe('co-managed durable intake selection', () => {
  it('requires durable intake across installation modes and retains the choice after independent upgrade', async () => {
    const { operation, actor, customer } = await readyForAcceptance();
    const { getTenantInboundEmailPolicy } = await import('../../../../shared/services/email/inboundEmailDurableStore');
    for (const mode of ['off', 'shadow', 'enforce'] as const) await withInboundMode(mode, async () => {
      expect(await getTenantInboundEmailPolicy(actor.tenant, db)).toEqual({ mode: 'enforce', requiresDurable: true });
      expect(await getTenantInboundEmailPolicy(operation.tenant, db)).toEqual({ mode, requiresDurable: false });
    });
    await customer.table('co_management_relationships').update({ state: 'terminated', ended_at: new Date() });
    await customer.table('tenants').update({ product_code: 'psa' });
    await withInboundMode('off', async () => {
      expect(await getTenantInboundEmailPolicy(actor.tenant, db)).toEqual({ mode: 'enforce', requiresDurable: true });
      await expect(getTenantInboundEmailPolicy(randomUUID(), db)).rejects.toThrow('does not exist');
    });
  });

  it('persists Microsoft, Google, and IMAP pointers while rollout is off even when Redis handoff fails', async () => {
    const { actor, customer } = await readyForAcceptance();
    const { persistIngressPointer } = await import('../../../../shared/services/email/inboundEmailProducer');
    durableTransport.enqueue.mockReset(); durableTransport.enqueue.mockRejectedValue(new Error('Redis unavailable'));
    const pointers = [
      { providerType: 'microsoft' as const, providerMessageId: 'ms-message', extra: { subscriptionId: 'subscription' } },
      { providerType: 'google' as const, historyId: '200', pubsubMessageId: 'pubsub', mailbox: 'help@example.test' },
      { providerType: 'imap' as const, mailbox: 'INBOX', uid: '24', uidValidity: '2', providerMessageId: 'imap-message' },
    ];
    await withInboundMode('off', async () => {
      for (const pointer of pointers) {
        const providerId = randomUUID();
        await customer.table('email_providers').insert({ tenant: actor.tenant, id: providerId, provider_type: pointer.providerType,
          provider_name: 'Co-managed Inbox', mailbox: `${pointer.providerType}@example.test`, is_active: true, status: 'connected' });
        const params = { tenant: actor.tenant, providerId, providerType: pointer.providerType, pointer };
        const result = await persistIngressPointer(params);
        expect(result).toMatchObject({ mode: 'enforce', durable: true, enqueued: false, ingressId: expect.any(String) });
        expect(await persistIngressPointer(params)).toEqual(result);
      }
    });
    expect(await customer.table('inbound_email_ingress')).toHaveLength(3);
    expect(await customer.table('email_processed_messages')).toHaveLength(0);
    durableTransport.enqueue.mockReset();
  });

  it('hands an old V1 delivery to durable ingress without running legacy effects or needing a license renewal first', async () => {
    const { actor, customer } = await readyForAcceptance();
    const providerId = randomUUID();
    await customer.table('email_providers').insert({ tenant: actor.tenant, id: providerId, provider_type: 'google',
      provider_name: 'Old producer', mailbox: 'help@example.test', is_active: true, status: 'connected' });
    const { processUnifiedInboundEmailQueueJob } = await import('../../../../shared/services/email/unifiedInboundEmailQueueJobProcessor');
    intake.process.mockReset(); durableTransport.enqueue.mockReset(); durableTransport.enqueue.mockRejectedValue(new Error('Redis unavailable'));
    const job = { schemaVersion: 1 as const, provider: 'google' as const, tenantId: actor.tenant, providerId,
      jobId: randomUUID(), enqueuedAt: new Date().toISOString(), attempt: 0, maxAttempts: 5,
      pointer: { historyId: '200', emailAddress: 'help@example.test', pubsubMessageId: 'legacy-pubsub', discoveredMessageIds: ['message-1'] } };
    await withInboundMode('off', async () => {
      expect(await processUnifiedInboundEmailQueueJob(job)).toMatchObject({ outcome: 'handed_off', processedCount: 0, reason: 'required_durable_ingress' });
      expect(await processUnifiedInboundEmailQueueJob(job)).toMatchObject({ outcome: 'handed_off' });
      await expect(processUnifiedInboundEmailQueueJob({ ...job, provider: 'microsoft',
        pointer: { messageId: '', subscriptionId: '' } })).rejects.toThrow('did not persist');
    });
    expect(await customer.table('inbound_email_ingress')).toEqual([expect.objectContaining({
      provider_pointer: expect.objectContaining({ discoveredMessageIds: ['message-1'], historyId: '200' }),
    })]);
    expect(await customer.table('email_processed_messages')).toHaveLength(0);
    expect(intake.process).not.toHaveBeenCalled();
    durableTransport.enqueue.mockReset();
  });

  it('dispatches co-managed inboxes to lifecycle deferral while the installation default is off', async () => {
    const { operation, actor } = await readyForAcceptance(), inbox = await stagedCoManagedInbox(actor.tenant);
    const { processUnifiedInboundEmailDurableJob } = await import('../../../../shared/services/email/unifiedInboundEmailQueueJobProcessorV2');
    const context = { signal: new AbortController().signal, renew: async () => true, registerPostgresLease: vi.fn() };
    const job = { schemaVersion: 2 as const, workType: 'process_inbox' as const, tenantId: actor.tenant,
      recordId: inbox.inbox_id, jobId: randomUUID(), enqueuedAt: new Date().toISOString(), attempt: 0, maxAttempts: 5 };
    await withInboundMode('off', async () => {
      expect(await processUnifiedInboundEmailDurableJob(job, context)).toMatchObject({ disposition: 'defer', reason: 'co_managed_pending_acceptance' });
      for (const workType of ['stage_ingress', 'process_inbox', 'process_artifact', 'publish_outbox', 'republish_outbox_event'] as const) {
        expect(await processUnifiedInboundEmailDurableJob({ ...job, workType, tenantId: operation.tenant }, context))
          .toMatchObject({ disposition: 'defer', reason: 'durable_mode_off' });
      }
    });
    expect(context.registerPostgresLease).not.toHaveBeenCalled();
  });

  it('stages already-fetched IMAP source and schedules core processing when rollout is off', async () => {
    const { actor, customer } = await readyForAcceptance(), providerId = randomUUID(), messageId = randomUUID();
    await customer.table('email_providers').insert({ tenant: actor.tenant, id: providerId, provider_type: 'imap',
      provider_name: 'IMAP', mailbox: 'help@example.test', is_active: true, status: 'connected' });
    const { stageReadyInboundSource } = await import('../../../../shared/services/email/inboundEmailProducer');
    intake.parse.mockReset(); intake.stage.mockReset(); durableTransport.enqueue.mockReset();
    intake.parse.mockResolvedValue({ normalizedMessageId: messageId, providerMessageId: messageId,
      rfcMessageId: `<${messageId}@example.test>`, emailData: { id: messageId, subject: 'IMAP source', from: { email: 'user@example.test' }, attachments: [] } });
    intake.stage.mockResolvedValue({ objectKey: `test/${messageId}.eml`, sha256: 'b'.repeat(64), sizeBytes: 40 });
    await withInboundMode('off', async () => {
      const result = await stageReadyInboundSource({ tenant: actor.tenant, providerId, providerType: 'imap',
        pointer: { providerType: 'imap', mailbox: 'INBOX', uid: '1', uidValidity: '2' }, rawMime: Buffer.from('retained IMAP source') });
      expect(result).toEqual({ durable: true, inboxId: expect.any(String) });
      expect(durableTransport.enqueue).toHaveBeenCalledWith({ workType: 'process_inbox', tenantId: actor.tenant, recordId: result.inboxId });
    });
    expect(await customer.table('inbound_email_inbox')).toHaveLength(1);
    expect(await customer.table('inbound_email_ingress')).toEqual([expect.objectContaining({ status: 'staged' })]);
  });

  it('sweeps retained co-managed inboxes in off and shadow installations', async () => {
    const { actor } = await readyForAcceptance(), inbox = await stagedCoManagedInbox(actor.tenant);
    const dbModule = await import('@alga-psa/db');
    const connection = vi.spyOn(dbModule, 'createTenantKnex').mockResolvedValue({ knex: db, tenant: actor.tenant });
    try {
      const { sweepTenantDurableWork } = await import('../../../../shared/services/email/inboundEmailRecovery');
      for (const mode of ['off', 'shadow']) await withInboundMode(mode, async () => {
        durableTransport.enqueue.mockReset();
        const result = await sweepTenantDurableWork(actor.tenant);
        expect(result.enqueued.inbox).toBe(1);
        expect(durableTransport.enqueue).toHaveBeenCalledWith({ workType: 'process_inbox', tenantId: actor.tenant, recordId: inbox.inbox_id });
      });
    } finally { connection.mockRestore(); }
  });
});

it('deduplicates co-managed outbox consumers even with installation rollout off', async () => {
  const { operation, actor, customer } = await readyForAcceptance(), inbox = await stagedCoManagedInbox(actor.tenant);
  const { insertOutboxRow } = await import('../../../../shared/services/email/inboundEmailDurableStore');
  const { reserveInboundOutboxEventForConsumer, completeInboundOutboxEventForConsumer } =
    await import('../../../../shared/services/email/inboundEmailConsumerDedupe');
  const id = randomUUID(), event = { id, eventType: 'TICKET_CREATED', payload: { tenantId: actor.tenant } };
  await insertOutboxRow(db, { tenant: actor.tenant, inbox_id: inbox.inbox_id, outbox_id: id,
    event_key: 'ticket-created', event_type: 'TICKET_CREATED', payload: event.payload });
  await withInboundMode('off', async () => {
    const params = { db, event, consumer: 'internal-notification', owner: 'first', failOpenOnLedgerError: false };
    const first = await reserveInboundOutboxEventForConsumer(params);
    expect(first).toMatchObject({ decision: 'deliver', token: expect.any(String), version: expect.any(Number) });
    expect(first.failOpen).not.toBe(true);
    expect(await completeInboundOutboxEventForConsumer({ ...params, token: first.token!, version: first.version! })).toBe(true);
    expect(await reserveInboundOutboxEventForConsumer({ ...params, owner: 'second' })).toMatchObject({ decision: 'skip' });
    expect(await reserveInboundOutboxEventForConsumer({ ...params, event: { ...event, payload: { tenantId: operation.tenant } } }))
      .toEqual({ decision: 'deliver', failOpen: true });
  });
  expect(await customer.table('inbound_email_event_deliveries')).toEqual([expect.objectContaining({ status: 'delivered' })]);
});

async function runCoManagedArtifact(tenantId: string, inboxId: string, artifactKey: string) {
  const { processInboundArtifactJob } = await import('../../../../shared/services/email/inboundEmailArtifactWorker');
  return processInboundArtifactJob({ version: 2, jobId: randomUUID(), tenantId, inboxId, recordId: artifactKey,
    workType: 'process_artifact', providerId: '', providerType: 'google', enqueuedAt: new Date().toISOString() } as any,
  { signal: new AbortController().signal, renew: async () => true, registerPostgresLease() {} });
}
async function expireCoManagedEntitlement(sponsorTenant: string) {
  const lapse = new Date(Date.now() - 31 * 86_400_000);
  await tenantDb(db, sponsorTenant).table('co_managed_entitlements').update({ valid_until: lapse, lapse_started_at: lapse,
    read_only_after: new Date(lapse.getTime() + 30 * 86_400_000) });
}

describe('durable co-managed attachments', () => {
  it('parks attachments without spending attempts or overwriting failure history and fences reclaimed pause releases', async () => {
    const { actor, customer } = await readyForAcceptance(), inbox = await stagedCoManagedInbox(actor.tenant);
    const store = await import('../../../../shared/services/email/inboundEmailDurableStore');
    await store.insertArtifacts(db, actor.tenant, ['pending', 'retryable_failed', 'fenced'].map(key => ({ tenant: actor.tenant,
      inbox_id: inbox.inbox_id, artifact_key: key, artifact_type: 'attachment' })));
    await customer.table('inbound_email_artifacts').where('artifact_key', 'retryable_failed')
      .update({ status: 'retryable_failed', attempt_count: 3, next_attempt_at: new Date(0), last_error: 'previous download failure' });
    intake.read.mockReset(); artifactStorage.upload.mockReset();
    for (let i = 0; i < 7; i++) for (const key of ['pending', 'retryable_failed']) {
      expect(await runCoManagedArtifact(actor.tenant, inbox.inbox_id, key))
        .toMatchObject({ disposition: 'defer', reason: 'co_managed_pending_acceptance' });
    }
    expect(intake.read).not.toHaveBeenCalled(); expect(artifactStorage.upload).not.toHaveBeenCalled();
    expect(await store.getArtifact(db, actor.tenant, inbox.inbox_id, 'pending')).toMatchObject({ status: 'pending', attempt_count: 0 });
    expect(await store.getArtifact(db, actor.tenant, inbox.inbox_id, 'retryable_failed'))
      .toMatchObject({ status: 'retryable_failed', attempt_count: 3, last_error: 'previous download failure' });
    expect((await store.findDueArtifacts(db, { tenant: actor.tenant })).map(row => row.artifact_key)).toEqual(['fenced']);
    expect(await store.claimArtifact(db, { tenant: actor.tenant, inbox_id: inbox.inbox_id,
      artifact_key: 'pending', owner: 'early', leaseTtlMs: 30_000 })).toEqual({ claimed: false, reason: 'not_due' });
    const params = { tenant: actor.tenant, inbox_id: inbox.inbox_id, artifact_key: 'fenced', owner: 'first', leaseTtlMs: 30_000 };
    const first = await store.claimArtifact(db, params); if (!first.claimed) throw new Error('Expected claim');
    await customer.table('inbound_email_artifacts').where('artifact_key', 'fenced').update({ lease_expires_at: new Date(0) });
    const second = await store.reclaimArtifact(db, { ...params, owner: 'second' }); if (!second.claimed) throw new Error('Expected reclaim');
    const pause = { tenant: actor.tenant, inboxId: inbox.inbox_id, artifactKey: 'fenced', until: new Date(Date.now() + 60_000) };
    expect(await store.deferArtifactForCoManagedLifecycle(db, { ...pause, claim: { owner: 'first',
      token: first.row.lease_token!, version: first.row.lease_version, refundAttempt: true } })).toBe(false);
    expect(await store.deferArtifactForCoManagedLifecycle(db, { ...pause, claim: { owner: 'second',
      token: second.row.lease_token!, version: second.row.lease_version, refundAttempt: false } })).toBe(true);
    expect(await store.getArtifact(db, actor.tenant, inbox.inbox_id, 'fenced')).toMatchObject({ status: 'pending', attempt_count: 1 });
  });

  it('rolls back documents when expiry wins during upload, refunds the attempt, and resumes exactly once after renewal', async () => {
    const { operation, actor, customer, input } = await readyForAcceptance(); await acceptCoManagedRelationship(db, actor, input);
    const { service } = await ticketServiceForTest();
    const status = await customer.table('statuses').where({ board_id: operation.customer_board_id, item_type: 'ticket' }).first();
    const priority = await customer.table('priorities').where({ item_type: 'ticket' }).first();
    const ticket = await service.create({ title: 'Attachment destination', description: '', client_id: operation.customer_client_id,
      board_id: operation.customer_board_id, status_id: status.status_id, priority_id: priority.priority_id },
    { tenant: actor.tenant, userId: actor.userId });
    const inbox = await stagedCoManagedInbox(actor.tenant), key = 'file-1';
    const comment = await service.addComment(ticket.ticket_id, { comment_text: 'Retained message', is_internal: false, is_resolution: false },
      { tenant: actor.tenant, userId: actor.userId });
    await customer.table('inbound_email_inbox').where('inbox_id', inbox.inbox_id)
      .update({ status: 'succeeded', outcome_kind: 'created', ticket_id: ticket.ticket_id,
        comment_id: comment.comment_id, completed_at: new Date() });
    const store = await import('../../../../shared/services/email/inboundEmailDurableStore');
    await store.insertArtifacts(db, actor.tenant, [{ tenant: actor.tenant, inbox_id: inbox.inbox_id,
      artifact_key: key, artifact_type: 'attachment', source_attachment_id: key }]);
    intake.read.mockReset().mockResolvedValue(Buffer.from('retained source'));
    intake.parse.mockReset().mockResolvedValue({ emailData: { id: inbox.provider_message_id, body: { text: 'file' },
      rawMime: 'Subject: retained\r\n\r\nfile', attachments: [{ id: key, name: 'notes.txt', contentType: 'text/plain',
        size: 5, content: Buffer.from('notes').toString('base64') }] } });
    artifactStorage.delete.mockReset().mockResolvedValue(undefined);
    artifactStorage.upload.mockReset().mockImplementationOnce(async (_buffer, path) => {
      await expireCoManagedEntitlement(operation.tenant);
      return { path };
    }).mockImplementation(async (_buffer, path) => ({ path }));
    expect(await runCoManagedArtifact(actor.tenant, inbox.inbox_id, key))
      .toMatchObject({ disposition: 'defer', reason: 'co_managed_read_only' });
    for (const table of ['documents', 'external_files', 'document_associations', 'document_folders']) {
      expect(await customer.table(table)).toEqual([]);
    }
    expect(artifactStorage.delete).toHaveBeenCalledOnce();
    expect(await store.getArtifact(db, actor.tenant, inbox.inbox_id, key))
      .toMatchObject({ status: 'pending', attempt_count: 0, lease_owner: null, lease_token: null });
    const entitlement = await tenantDb(db, operation.tenant).table('co_managed_entitlements').first();
    await reconcileHostedCoManagedEntitlement(db, operation.tenant, entitlement.source_reference,
      async () => ({ active: true, capacity: 2, validUntil: new Date(Date.now() + 3600000) }));
    await customer.table('inbound_email_artifacts').update({ next_attempt_at: new Date(0) });
    expect(await runCoManagedArtifact(actor.tenant, inbox.inbox_id, key)).toMatchObject({ disposition: 'ack' });
    expect(await store.getArtifact(db, actor.tenant, inbox.inbox_id, key))
      .toMatchObject({ status: 'succeeded', attempt_count: 1, file_id: expect.any(String), document_id: expect.any(String) });
    expect(await customer.table('documents').where('document_name', 'notes.txt')).toHaveLength(1);
    expect(await customer.table('documents')).toHaveLength(2);
    expect(await customer.table('document_associations')).toHaveLength(2);
    const uploads = artifactStorage.upload.mock.calls.length;
    await expireCoManagedEntitlement(operation.tenant);
    expect(await runCoManagedArtifact(actor.tenant, inbox.inbox_id, key)).toMatchObject({ disposition: 'ack' });
    expect(artifactStorage.upload.mock.calls).toHaveLength(uploads);
    expect(await customer.table('tickets')).toHaveLength(1);
  });
});

it('preserves ticket assets and documents after lapse and permits their removal and ticket deletion after renewal', async () => {
  const { operation, actor, customer, input } = await readyForAcceptance(); await acceptCoManagedRelationship(db, actor, input);
  const { service, publish } = await ticketServiceForTest(), context = { tenant: actor.tenant, userId: actor.userId };
  const status = await customer.table('statuses').where({ board_id: operation.customer_board_id, item_type: 'ticket' }).first();
  const priority = await customer.table('priorities').where({ item_type: 'ticket' }).first();
  const ticket = await service.create({ title: 'Keep customer work', description: '', client_id: operation.customer_client_id,
    board_id: operation.customer_board_id, status_id: status.status_id, priority_id: priority.priority_id }, context);
  const assetId = randomUUID(), documentId = randomUUID();
  await customer.table('assets').insert({ tenant: actor.tenant, asset_id: assetId, asset_tag: 'CUSTOMER-1', name: 'Workstation',
    status: 'active', asset_type: 'workstation', client_id: operation.customer_client_id });
  await service.linkAsset(ticket.ticket_id, { asset_id: assetId }, context);
  await customer.table('documents').insert({ tenant: actor.tenant, document_id: documentId, document_name: 'Customer instructions',
    user_id: actor.userId, created_by: actor.userId });
  await customer.table('document_associations').insert({ tenant: actor.tenant, association_id: randomUUID(), document_id: documentId,
    entity_id: ticket.ticket_id, entity_type: 'ticket' });
  await expireCoManagedEntitlement(operation.tenant);
  publish.mockClear();
  for (const mutate of [() => service.delete(ticket.ticket_id, context), () => service.unlinkAsset(ticket.ticket_id, assetId, context),
    () => service.deleteTicketDocument(ticket.ticket_id, documentId, context)]) {
    await expect(mutate()).rejects.toMatchObject({ code: 'CO_MANAGED_READ_ONLY' });
  }
  expect(await customer.table('tickets')).toHaveLength(1);
  expect(await customer.table('asset_associations')).toHaveLength(1);
  expect(await customer.table('documents')).toHaveLength(1);
  expect(await customer.table('document_associations')).toHaveLength(1);
  expect(publish).not.toHaveBeenCalled();
  const entitlement = await tenantDb(db, operation.tenant).table('co_managed_entitlements').first();
  await reconcileHostedCoManagedEntitlement(db, operation.tenant, entitlement.source_reference,
    async () => ({ active: true, capacity: 2, validUntil: new Date(Date.now() + 3600000) }));
  await service.unlinkAsset(ticket.ticket_id, assetId, context);
  await service.deleteTicketDocument(ticket.ticket_id, documentId, context);
  await runWithTenant(actor.tenant, () => service.delete(ticket.ticket_id, context));
  for (const table of ['tickets', 'asset_associations', 'documents', 'document_associations']) expect(await customer.table(table)).toEqual([]);
  expect(await customer.table('assets')).toHaveLength(1);
  expect(publish).toHaveBeenCalledWith('TICKET_DELETED', context, { ticketId: ticket.ticket_id, userId: actor.userId });
});

describe('canonical material lifecycle admission', () => {
  it('guards direct ticket/project material mutations and the ticket API before any material or stock access', async () => {
    const { operation, actor, customer, input } = await readyForAcceptance();
    const { addMaterial, deleteMaterial, updateProjectMaterialBilling } = await import('../../../../packages/inventory/src/lib/materials');
    const { service } = await ticketServiceForTest();
    const id = randomUUID(), product = randomUUID();
    const mutations = [
      ...(['ticket', 'project'] as const).flatMap(parent_type => [
        () => addMaterial(db, actor.tenant, { parent_type, parent_id: id, service_id: product, quantity: 1, rate: 0 }, actor.userId),
        () => deleteMaterial(db, actor.tenant, parent_type, id, actor.userId),
      ]),
      () => updateProjectMaterialBilling(db, actor.tenant, id, { rate: 0, billing_destination: 'on_hold' }),
      () => service.addTicketMaterial(id, { service_id: product, quantity: 1, rate: 0, currency_code: 'USD' },
        { tenant: actor.tenant, userId: actor.userId }),
    ];
    for (const mutate of mutations) await expect(mutate()).rejects.toMatchObject({ code: 'CO_MANAGED_NOT_ACTIVE' });
    await acceptCoManagedRelationship(db, actor, input); await expireCoManagedEntitlement(operation.tenant);
    for (const mutate of mutations) await expect(mutate()).rejects.toMatchObject({ code: 'CO_MANAGED_READ_ONLY' });
    for (const table of ['ticket_materials', 'project_materials', 'stock_movements', 'stock_units', 'stock_levels']) {
      expect(await customer.table(table)).toEqual([]);
    }
  });

  it('retains consumed stock after lapse and reverses it atomically after renewal', async () => {
    const { operation, actor, customer, input } = await readyForAcceptance(); await acceptCoManagedRelationship(db, actor, input);
    const { service } = await ticketServiceForTest();
    const status = await customer.table('statuses').where({ board_id: operation.customer_board_id, item_type: 'ticket' }).first();
    const priority = await customer.table('priorities').where({ item_type: 'ticket' }).first();
    const ticket = await service.create({ title: 'Retain consumed stock', description: '', client_id: operation.customer_client_id,
      board_id: operation.customer_board_id, status_id: status.status_id, priority_id: priority.priority_id },
    { tenant: actor.tenant, userId: actor.userId });
    const typeId = randomUUID(), serviceId = randomUUID(), locationId = randomUUID();
    await customer.table('service_types').insert({ tenant: actor.tenant, id: typeId, name: 'Fixture products' });
    await customer.table('service_catalog').insert({ tenant: actor.tenant, service_id: serviceId, service_name: 'Fixture cable',
      item_kind: 'product', custom_service_type_id: typeId, billing_method: 'per_unit', default_rate: 0 });
    await customer.table('stock_locations').insert({ tenant: actor.tenant, location_id: locationId, name: 'Fixture shelf', is_default: true });
    await customer.table('product_inventory_settings').insert({ tenant: actor.tenant, service_id: serviceId, track_stock: true,
      is_serialized: false, cost_currency: 'USD', default_location_id: locationId, average_cost: 0 });
    const { recordStockMovement } = await import('../../../../packages/inventory/src/lib/movements');
    await db.transaction(trx => recordStockMovement(trx, actor.tenant, { movement_type: 'receipt', service_id: serviceId,
      quantity: 3, to_location_id: locationId }));
    const { addMaterial, deleteMaterial, listMaterials } = await import('../../../../packages/inventory/src/lib/materials');
    const material = await addMaterial(db, actor.tenant, { parent_type: 'ticket', parent_id: ticket.ticket_id,
      service_id: serviceId, quantity: 1, rate: 0, currency_code: 'USD' }, actor.userId) as { ticket_material_id: string };
    const onHand = async () => Number((await customer.table('stock_levels').where({ service_id: serviceId, location_id: locationId }).first()).quantity_on_hand);
    expect(await onHand()).toBe(2);
    await expireCoManagedEntitlement(operation.tenant);
    await expect(deleteMaterial(db, actor.tenant, 'ticket', material.ticket_material_id, actor.userId))
      .rejects.toMatchObject({ code: 'CO_MANAGED_READ_ONLY' });
    expect(await onHand()).toBe(2);
    expect(await listMaterials(db, actor.tenant, 'ticket', ticket.ticket_id)).toHaveLength(1);
    expect(await customer.table('stock_movements')).toHaveLength(2);
    const entitlement = await tenantDb(db, operation.tenant).table('co_managed_entitlements').first();
    await reconcileHostedCoManagedEntitlement(db, operation.tenant, entitlement.source_reference,
      async () => ({ active: true, capacity: 2, validUntil: new Date(Date.now() + 3600000) }));
    await expect(db.transaction(async trx => {
      expect(await deleteMaterial(trx, actor.tenant, 'ticket', material.ticket_material_id, actor.userId)).toBe(true);
      throw new Error('Rollback caller');
    })).rejects.toThrow('Rollback caller');
    expect(await onHand()).toBe(2);
    expect(await listMaterials(db, actor.tenant, 'ticket', ticket.ticket_id)).toHaveLength(1);
    expect(await deleteMaterial(db, actor.tenant, 'ticket', material.ticket_material_id, actor.userId)).toBe(true);
    expect(await onHand()).toBe(3);
    expect(await listMaterials(db, actor.tenant, 'ticket', ticket.ticket_id)).toEqual([]);
    expect(await customer.table('stock_movements')).toHaveLength(3);
  });
});

async function withStorageFixture(work: (fixture: Awaited<ReturnType<typeof readyForAcceptance>> & {
  storage: typeof import('../../../../packages/storage/src/StorageService').StorageService;
  files: typeof import('../../../../packages/storage/src/models/storage').FileStoreModel;
  publish: ReturnType<typeof vi.spyOn>;
}) => Promise<void>) {
  const fixture = await readyForAcceptance();
  const database = await import('@alga-psa/db');
  const events = await import('@alga-psa/event-bus/publishers');
  const connection = vi.spyOn(database, 'createTenantKnex').mockImplementation(async tenant => ({ knex: db, tenant: tenant ?? fixture.actor.tenant }));
  const publish = vi.spyOn(events, 'publishWorkflowEvent').mockResolvedValue(undefined);
  const { StorageService: storage } = await import('../../../../packages/storage/src/StorageService');
  const { FileStoreModel: files } = await import('../../../../packages/storage/src/models/storage');
  artifactStorage.upload.mockReset().mockImplementation(async (buffer, path) => ({ path, size: buffer.length, mime_type: 'text/plain' }));
  artifactStorage.delete.mockReset().mockResolvedValue(undefined);
  artifactStorage.download.mockReset().mockResolvedValue(Buffer.from('saved'));
  try { await runWithTenant(fixture.actor.tenant, () => work({ ...fixture, storage, files, publish })); }
  finally { connection.mockRestore(); publish.mockRestore(); }
}

function storageFileData(userId: string) {
  return { file_name: 'saved.txt', original_name: 'saved.txt', mime_type: 'text/plain', file_size: 5,
    storage_path: `fixture/${randomUUID()}`, uploaded_by_id: userId };
}

describe('co-managed storage lifecycle admission', () => {
  it('guards file metadata entry points while preserving read access after expiry', async () => withStorageFixture(async ({ operation, actor, input, customer, storage, files }) => {
    const id = randomUUID();
    const mutations = [
      () => files.create(db, storageFileData(actor.userId)),
      () => files.updateMetadata(db, id, { changed: true }),
      () => files.softDelete(db, id, actor.userId),
      () => files.createDocumentSystemEntry(db, { fileId: id, category: 'fixture', metadata: {} }),
      () => storage.uploadFile(actor.tenant, Buffer.from('saved'), 'saved.txt', { uploaded_by_id: actor.userId }),
    ];
    for (const mutate of mutations) await expect(mutate()).rejects.toMatchObject({ code: 'CO_MANAGED_NOT_ACTIVE' });
    expect(artifactStorage.upload).not.toHaveBeenCalled();
    await acceptCoManagedRelationship(db, actor, input);
    const file = await files.create(db, storageFileData(actor.userId));
    await files.updateMetadata(db, file.file_id, { retained: true });
    const migration = require('../../../migrations/20260906100000_add_external_file_metadata.cjs');
    await migration.up(db);
    await expect(migration.down(db)).rejects.toThrow('while stored values exist');
    await expireCoManagedEntitlement(operation.tenant);
    for (const mutate of mutations) await expect(mutate()).rejects.toMatchObject({ code: 'CO_MANAGED_READ_ONLY' });
    await expect(storage.updateFileMetadata(file.file_id, { changed: true })).rejects.toMatchObject({ code: 'CO_MANAGED_READ_ONLY' });
    await expect(storage.createDocumentSystemEntry({ fileId: file.file_id, category: 'fixture', metadata: {} }))
      .rejects.toMatchObject({ code: 'CO_MANAGED_READ_ONLY' });
    await expect(storage.deleteFile(file.file_id, actor.userId)).rejects.toMatchObject({ code: 'CO_MANAGED_READ_ONLY' });
    expect(await files.findById(db, file.file_id)).toMatchObject({ metadata: { retained: true }, is_deleted: false });
    expect(await files.list(db)).toHaveLength(1);
    expect(await storage.downloadFile(file.file_id)).toMatchObject({ buffer: Buffer.from('saved') });
    expect(artifactStorage.delete).not.toHaveBeenCalled();
    expect(await customer.table('document_system_entries')).toEqual([]);
  }));

  it('cleans rejected buffer/stream uploads and retains no file records or workflow events when expiry wins during transport', async () => withStorageFixture(async ({ operation, actor, input, customer, storage, publish }) => {
    await acceptCoManagedRelationship(db, actor, input);
    const { Readable } = await import('node:stream');
    for (const upload of [
      () => storage.uploadFile(actor.tenant, Buffer.from('saved'), 'saved.txt', { uploaded_by_id: actor.userId }),
      () => storage.uploadStream(actor.tenant, Readable.from(Buffer.from('saved')), 'saved.txt', { uploaded_by_id: actor.userId, size: 5, metadata: { kept: true } }),
    ]) {
      artifactStorage.upload.mockImplementationOnce(async (_data, path) => {
        await expireCoManagedEntitlement(operation.tenant);
        return { path, size: 5, mime_type: 'text/plain' };
      });
      await expect(upload()).rejects.toMatchObject({ code: 'CO_MANAGED_READ_ONLY' });
      expect(await customer.table('external_files')).toEqual([]);
      expect(publish).not.toHaveBeenCalled();
      const entitlement = await tenantDb(db, operation.tenant).table('co_managed_entitlements').first();
      await reconcileHostedCoManagedEntitlement(db, operation.tenant, entitlement.source_reference,
        async () => ({ active: true, capacity: 2, validUntil: new Date(Date.now() + 3600000) }));
    }
    expect(artifactStorage.delete).toHaveBeenCalledTimes(2);
    const file = await storage.uploadFile(actor.tenant, Buffer.from('saved'), 'saved.txt', {
      uploaded_by_id: actor.userId, metadata: { source: 'buffer' },
    });
    expect(await customer.table('external_files')).toEqual([expect.objectContaining({ file_id: file.file_id, metadata: { source: 'buffer' } })]);
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'FILE_UPLOADED' }));
    artifactStorage.upload.mockImplementationOnce(async (_data, path) => ({ path, size: 5, mime_type: 'text/plain' }));
    const streamed = await storage.uploadStream(actor.tenant, Readable.from(Buffer.from('saved')), 'streamed.txt', {
      uploaded_by_id: actor.userId, size: 5, metadata: { source: 'stream' },
    });
    expect(await customer.table('external_files').where('file_id', streamed.file_id).first()).toMatchObject({ metadata: { source: 'stream' } });
  }));

  it('holds admission through physical deletion, rolls back metadata on provider failure, and publishes only after commit', async () => withStorageFixture(async ({ operation, actor, input, customer, storage, files, publish }) => {
    await acceptCoManagedRelationship(db, actor, input);
    const file = await files.create(db, storageFileData(actor.userId));
    artifactStorage.delete.mockRejectedValueOnce(new Error('Provider unavailable'));
    await expect(storage.deleteFile(file.file_id, actor.userId)).rejects.toThrow('Provider unavailable');
    expect(await files.findById(db, file.file_id)).toMatchObject({ is_deleted: false });
    expect(publish).not.toHaveBeenCalled();
    artifactStorage.delete.mockImplementationOnce(async () => {
      expect(await files.findById(db, file.file_id)).toMatchObject({ is_deleted: false });
      await expect(db.transaction(async trx => {
        await trx.raw("SET LOCAL lock_timeout = '50ms'");
        await tenantDb(trx, operation.tenant).table('co_managed_entitlements').update({ valid_until: new Date(0) });
      })).rejects.toMatchObject({ code: '55P03' });
    });
    let publishedAfterCommit = false;
    publish.mockImplementation(async () => {
      publishedAfterCommit = (await customer.table('external_files').where('file_id', file.file_id).first()).is_deleted;
    });
    await storage.deleteFile(file.file_id, actor.userId);
    expect(await files.findById(db, file.file_id)).toBeNull();
    expect(publishedAfterCommit).toBe(true);
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'DOCUMENT_DELETED' }));
  }));
});

it('commits ticket upload records together and publishes only after the attachment is available', async () => withStorageFixture(async ({ operation, actor, input, customer, publish }) => {
  await acceptCoManagedRelationship(db, actor, input);
  const { service } = await ticketServiceForTest(), context = { tenant: actor.tenant, userId: actor.userId };
  const status = await customer.table('statuses').where({ board_id: operation.customer_board_id, item_type: 'ticket' }).first();
  const priority = await customer.table('priorities').where({ item_type: 'ticket' }).first();
  const ticket = await service.create({ title: 'Atomic attachment', description: '', client_id: operation.customer_client_id,
    board_id: operation.customer_board_id, status_id: status.status_id, priority_id: priority.priority_id }, context);
  await customer.table('document_types').insert({ tenant: actor.tenant, type_id: randomUUID(), type_name: 'text/plain' });
  const file = new File(['saved'], 'saved.txt', { type: 'text/plain' });
  artifactStorage.upload.mockImplementationOnce(async (_buffer, path) => {
    await expireCoManagedEntitlement(operation.tenant);
    return { path, size: 5, mime_type: 'text/plain' };
  });
  await expect(service.uploadTicketDocument(ticket.ticket_id, file, context)).rejects.toMatchObject({ code: 'CO_MANAGED_READ_ONLY' });
  for (const table of ['external_files', 'documents', 'document_associations']) expect(await customer.table(table)).toEqual([]);
  expect(publish).not.toHaveBeenCalled();
  const entitlement = await tenantDb(db, operation.tenant).table('co_managed_entitlements').first();
  await reconcileHostedCoManagedEntitlement(db, operation.tenant, entitlement.source_reference,
    async () => ({ active: true, capacity: 2, validUntil: new Date(Date.now() + 3600000) }));
  const observedAttachments: number[] = [];
  publish.mockImplementation(async () => {
    const associations = await customer.table('document_associations').where({ entity_id: ticket.ticket_id, entity_type: 'ticket' });
    observedAttachments.push(associations.length);
  });
  const document = await service.uploadTicketDocument(ticket.ticket_id, file, context);
  expect(await customer.table('external_files')).toHaveLength(1);
  expect(await customer.table('documents')).toEqual([expect.objectContaining({ document_id: document.document_id, file_id: document.file_id })]);
  expect(observedAttachments.length).toBeGreaterThan(0);
  expect(observedAttachments.every(count => count === 1)).toBe(true);
  await expireCoManagedEntitlement(operation.tenant);
  const uploads = artifactStorage.upload.mock.calls.length;
  await expect(service.uploadTicketDocument(ticket.ticket_id, file, context)).rejects.toMatchObject({ code: 'CO_MANAGED_READ_ONLY' });
  expect(artifactStorage.upload.mock.calls).toHaveLength(uploads);
  expect(await service.downloadTicketDocument(ticket.ticket_id, document.document_id, context)).toMatchObject({ buffer: Buffer.from('saved') });
}));

async function operationalConfigurationServices() {
  const [{ BoardService }, { StatusService }, { PriorityService }] = await Promise.all([
    import('../../lib/api/services/BoardService'), import('../../lib/api/services/StatusService'), import('../../lib/api/services/PriorityService'),
  ]);
  const services = { boards: new BoardService(), statuses: new StatusService(), priorities: new PriorityService() };
  for (const service of Object.values(services)) vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: db });
  return services;
}

describe('inherited operational API mutations', () => {
  it('enforces admission on every inherited single and bulk mutation for boards, statuses, and priorities', async () => {
    const { operation, actor, input, customer } = await readyForAcceptance();
    const services = await operationalConfigurationServices(), context = { tenant: actor.tenant, userId: actor.userId }, id = randomUUID();
    const publisher = await import('../../lib/eventBus/publishers');
    const publish = vi.spyOn(publisher, 'publishEvent').mockResolvedValue(undefined);
    try {
      for (const expectedCode of ['CO_MANAGED_NOT_ACTIVE', 'CO_MANAGED_READ_ONLY']) {
        for (const service of Object.values(services)) {
          for (const mutate of [() => service.create({}, context), () => service.update(id, {}, context), () => service.delete(id, context),
            () => service.bulkCreate([{}], context), () => service.bulkUpdate([{ id, data: {} }], context), () => service.bulkDelete([id], context)]) {
            await expect(mutate()).rejects.toMatchObject({ code: expectedCode });
          }
        }
        if (expectedCode === 'CO_MANAGED_NOT_ACTIVE') {
          await acceptCoManagedRelationship(db, actor, input); await expireCoManagedEntitlement(operation.tenant);
        }
      }
      expect(publish).not.toHaveBeenCalled();
      const status = await customer.table('statuses').where({ board_id: operation.customer_board_id, item_type: 'ticket' }).first();
      const priority = await customer.table('priorities').where({ item_type: 'ticket' }).first();
      expect(await services.boards.getById(operation.customer_board_id, context)).toMatchObject({ board_name: 'Service Desk' });
      expect(await services.statuses.getById(status.status_id, context)).toMatchObject({ status_id: status.status_id });
      expect(await services.priorities.getById(priority.priority_id, context)).toMatchObject({ priority_id: priority.priority_id });
    } finally { publish.mockRestore(); }
  });

  it('supports real configuration edits and bulk operations after renewal without writing missing audit columns', async () => {
    const { operation, actor, input, customer } = await readyForAcceptance(); await acceptCoManagedRelationship(db, actor, input);
    const services = await operationalConfigurationServices(), context = { tenant: actor.tenant, userId: actor.userId };
    const publisher = await import('../../lib/eventBus/publishers');
    const publish = vi.spyOn(publisher, 'publishEvent').mockResolvedValue(undefined);
    try {
      const board = await services.boards.create({ board_name: 'Temporary customer board', is_inactive: false }, context);
      const status = await customer.table('statuses').where({ board_id: operation.customer_board_id, item_type: 'ticket' }).first();
      const priority = await customer.table('priorities').where({ item_type: 'ticket' }).first();
      await services.statuses.update(status.status_id, { name: 'Customer queue' }, context);
      await services.priorities.update(priority.priority_id, { priority_name: 'Customer priority' }, context);
      await expireCoManagedEntitlement(operation.tenant);
      await expect(services.boards.bulkDelete([board.board_id], context)).rejects.toMatchObject({ code: 'CO_MANAGED_READ_ONLY' });
      expect(await services.boards.getById(board.board_id, context)).toMatchObject({ board_name: 'Temporary customer board' });
      const entitlement = await tenantDb(db, operation.tenant).table('co_managed_entitlements').first();
      await reconcileHostedCoManagedEntitlement(db, operation.tenant, entitlement.source_reference,
        async () => ({ active: true, capacity: 2, validUntil: new Date(Date.now() + 3600000) }));
      const boards = await services.boards.bulkCreate([{ board_name: 'Customer A' }, { board_name: 'Customer B' }], context);
      expect(boards).toHaveLength(2);
      const updated = await services.boards.bulkUpdate(boards.map(row => ({ id: row.board_id, data: { is_inactive: true } })), context);
      expect(updated.every(row => row.is_inactive)).toBe(true);
      await services.statuses.bulkUpdate([{ id: status.status_id, data: { name: 'Renewed queue' } }], context);
      await services.priorities.bulkUpdate([{ id: priority.priority_id, data: { priority_name: 'Renewed priority' } }], context);
      await services.boards.bulkDelete(boards.map(row => row.board_id), context);
      await services.boards.delete(board.board_id, context);
      expect(await customer.table('boards')).toHaveLength(1);
      expect(await services.statuses.getById(status.status_id, context)).toMatchObject({ name: 'Renewed queue' });
      expect(await services.priorities.getById(priority.priority_id, context)).toMatchObject({ priority_name: 'Renewed priority' });
    } finally { publish.mockRestore(); }
  });
});

async function withProjectFixture(work: (fixture: Awaited<ReturnType<typeof readyForAcceptance>> & {
  service: import('../../lib/api/services/ProjectService').ProjectService;
  connection: ReturnType<typeof vi.spyOn>;
  publish: ReturnType<typeof vi.spyOn>;
  workflow: ReturnType<typeof vi.spyOn>;
}) => Promise<void>) {
  const fixture = await readyForAcceptance();
  const { ProjectService } = await import('../../lib/api/services/ProjectService');
  const service = new ProjectService();
  const connection = vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: db });
  const events = await import('../../lib/eventBus/publishers');
  const publish = vi.spyOn(events, 'publishEvent').mockResolvedValue(undefined);
  const workflow = vi.spyOn(events, 'publishWorkflowEvent').mockResolvedValue(undefined);
  try { await runWithTenant(fixture.actor.tenant, () => work({ ...fixture, service, connection, publish, workflow })); }
  finally { publish.mockRestore(); workflow.mockRestore(); connection.mockRestore(); }
}

describe('co-managed project API lifecycle admission', () => {
  it('denies project, phase, task, checklist, link, and bulk mutations before acceptance and after expiry', async () => withProjectFixture(async ({ operation, actor, input, customer, service, publish, workflow }) => {
    const context = { tenant: actor.tenant, userId: actor.userId }, id = randomUUID();
    const mutations = [
      () => service.create({ project_name: 'Denied project', client_id: operation.customer_client_id }, context),
      () => service.update(id, { project_name: 'Denied change' }, context),
      () => service.delete(id, context),
      () => service.createPhase(id, { phase_name: 'Denied phase' } as any, context),
      () => service.updatePhase(id, { phase_name: 'Denied change' }, context),
      () => service.deletePhase(id, context),
      () => service.createTask(id, { task_name: 'Denied task', project_status_mapping_id: id } as any, context),
      () => service.updateTask(id, { task_name: 'Denied change' }, context),
      () => service.deleteTask(id, context),
      () => service.createChecklistItem(id, { item_text: 'Denied checklist', is_completed: false }, context),
      () => service.createTicketLink(id, { ticket_id: id, link_type: 'related' }, context),
      () => service.bulkCreate([{}], context),
      () => service.bulkUpdate([{ id, data: { project_name: 'Denied inherited update' } }], context),
      () => service.bulkDelete([id], context),
      () => service.bulkUpdateProjects([id], { project_name: 'Denied bulk update' }, context),
      () => service.bulkAssign([id], actor.userId, context),
      () => service.bulkStatusUpdate([id], 'active', context),
    ];
    for (const mutate of mutations) await expect(mutate()).rejects.toMatchObject({ code: 'CO_MANAGED_NOT_ACTIVE' });
    await acceptCoManagedRelationship(db, actor, input); await expireCoManagedEntitlement(operation.tenant);
    for (const mutate of mutations) await expect(mutate()).rejects.toMatchObject({ code: 'CO_MANAGED_READ_ONLY' });
    for (const table of ['projects', 'project_phases', 'project_tasks', 'task_checklist_items', 'project_ticket_links']) {
      expect(await customer.table(table)).toEqual([]);
    }
    expect(publish).not.toHaveBeenCalled(); expect(workflow).not.toHaveBeenCalled();
  }));

  it('uses one bulk transaction, rolls back a failed member without events, and resumes after renewal', async () => withProjectFixture(async ({ operation, actor, input, customer, service, connection, publish, workflow }) => {
    await acceptCoManagedRelationship(db, actor, input);
    const context = { tenant: actor.tenant, userId: actor.userId };
    const first = await service.create({ project_name: 'First', client_id: operation.customer_client_id }, context);
    const second = await service.create({ project_name: 'Second', client_id: operation.customer_client_id }, context);
    publish.mockClear(); workflow.mockClear();
    // A lost transaction context fails immediately instead of hanging on this
    // operation's own sponsor lock on a second connection.
    connection.mockReset().mockRejectedValue(new Error('Nested update opened a new connection')).mockResolvedValueOnce({ knex: db });
    await expect(service.bulkUpdateProjects([first.project_id, randomUUID()], { project_name: 'Rolled back' }, context)).rejects.toThrow('Project not found');
    expect((await customer.table('projects').where('project_id', first.project_id).first()).project_name).toBe('First');
    expect(publish).not.toHaveBeenCalled(); expect(workflow).not.toHaveBeenCalled();
    connection.mockResolvedValue({ knex: db });
    await expireCoManagedEntitlement(operation.tenant);
    await expect(service.bulkUpdateProjects([first.project_id, second.project_id], { project_name: 'Paused' }, context))
      .rejects.toMatchObject({ code: 'CO_MANAGED_READ_ONLY' });
    expect(await service.getById(first.project_id, context)).toMatchObject({ project_name: 'First' });
    const entitlement = await tenantDb(db, operation.tenant).table('co_managed_entitlements').first();
    await reconcileHostedCoManagedEntitlement(db, operation.tenant, entitlement.source_reference,
      async () => ({ active: true, capacity: 2, validUntil: new Date(Date.now() + 3600000) }));
    const seenAtPublication: string[][] = [];
    workflow.mockImplementation(async () => {
      seenAtPublication.push((await customer.table('projects').orderBy('project_id')).map(row => row.project_name));
    });
    connection.mockReset().mockRejectedValue(new Error('Nested update opened a new connection')).mockResolvedValueOnce({ knex: db });
    const updated = await service.bulkUpdateProjects([first.project_id, second.project_id], { project_name: 'Renewed' }, context);
    expect(updated).toHaveLength(2);
    expect(connection).toHaveBeenCalledOnce();
    expect(workflow).toHaveBeenCalledTimes(2);
    expect(seenAtPublication).toEqual([['Renewed', 'Renewed'], ['Renewed', 'Renewed']]);
  }));

  it('creates a project, phase, and task in a caller transaction and discards events and records on rollback', async () => withProjectFixture(async ({ operation, actor, input, customer, service, connection, publish, workflow }) => {
    await acceptCoManagedRelationship(db, actor, input);
    const { withTransaction } = await import('@alga-psa/db');
    connection.mockReset().mockRejectedValue(new Error('Caller transaction was lost'));
    let projectId: string, phaseId: string, taskId: string;
    const createWork = async (trx: Knex.Transaction) => {
      const context = { tenant: actor.tenant, userId: actor.userId, db: trx };
      const project = await service.create({ project_name: 'Customer rollout', client_id: operation.customer_client_id }, context);
      projectId = project.project_id;
      const phase = await service.createPhase(project.project_id, { phase_name: 'Discovery' } as any, context); phaseId = phase.phase_id;
      const standard = await trx('standard_statuses').where({ item_type: 'project_task' }).orderBy('display_order').first();
      const mappingId = randomUUID();
      await tenantDb(trx, actor.tenant).table('project_status_mappings').insert({ tenant: actor.tenant,
        project_status_mapping_id: mappingId, project_id: project.project_id, standard_status_id: standard.standard_status_id,
        is_standard: true, display_order: 1, is_visible: true });
      const task = await service.createTask(phase.phase_id, { task_name: 'Inventory devices', task_type_key: 'general',
        project_status_mapping_id: mappingId }, context); taskId = task.task_id;
      expect(publish).not.toHaveBeenCalled(); expect(workflow).not.toHaveBeenCalled();
    };
    await expect(withTransaction(db, async trx => { await createWork(trx); throw new Error('Caller cancelled'); })).rejects.toThrow('Caller cancelled');
    for (const table of ['projects', 'project_phases', 'project_status_mappings', 'project_tasks']) expect(await customer.table(table)).toEqual([]);
    expect(publish).not.toHaveBeenCalled(); expect(workflow).not.toHaveBeenCalled();
    await withTransaction(db, createWork);
    expect(publish).toHaveBeenCalledOnce();
    expect(workflow).toHaveBeenCalledOnce();
    connection.mockResolvedValue({ knex: db });
    const context = { tenant: actor.tenant, userId: actor.userId };
    await service.updatePhase(phaseId!, { phase_name: 'Discovery completed' }, context);
    await service.updateTask(taskId!, { task_name: 'Inventory verified' }, context);
    await expireCoManagedEntitlement(operation.tenant);
    expect(await service.getPhases(projectId!, context)).toEqual([expect.objectContaining({ phase_name: 'Discovery completed' })]);
    expect(await service.getTasks(projectId!, context)).toEqual([expect.objectContaining({ task_name: 'Inventory verified' })]);
    await expect(service.deleteTask(taskId!, context)).rejects.toMatchObject({ code: 'CO_MANAGED_READ_ONLY' });
    expect(await customer.table('project_tasks')).toHaveLength(1);
  }));
});

describe('co-managed canonical project model lifecycle admission', () => {
  it('denies every project-model mutation before acceptance and after expiry', async () => withProjectFixture(async ({ operation, actor, input, customer }) => {
    const { ProjectModel: model } = await import('@alga-psa/projects/models');
    const tenant = actor.tenant, id = randomUUID();
    const mutations = [
      () => model.create(db, tenant, {} as any),
      () => model.update(db, tenant, id, {}),
      () => model.delete(db, tenant, id),
      () => model.addPhase(db, tenant, {} as any),
      () => model.updatePhase(db, tenant, id, {}),
      () => model.deletePhase(db, tenant, id),
      () => model.addProjectStatusMapping(db, tenant, id, {} as any),
      () => model.addStatusToProject(db, tenant, id, {} as any),
      () => model.updateProjectStatus(db, tenant, id, {}, {}),
      () => model.deleteProjectStatus(db, tenant, id),
      () => model.updateStructure(db, tenant, id, { phases: [], tasks: [] }),
      () => model.copyProjectStatusMappingsToPhase(db, tenant, id, id),
    ];
    for (const mutate of mutations) await expect(mutate()).rejects.toMatchObject({ code: 'CO_MANAGED_NOT_ACTIVE' });
    await acceptCoManagedRelationship(db, actor, input); await expireCoManagedEntitlement(operation.tenant);
    for (const mutate of mutations) await expect(mutate()).rejects.toMatchObject({ code: 'CO_MANAGED_READ_ONLY' });
    for (const table of ['projects', 'project_phases', 'project_status_mappings']) expect(await customer.table(table)).toEqual([]);
  }));

  it('retains reads during expiry and renews real model writes, status cloning, and cascading deletion', async () => withProjectFixture(async ({ operation, actor, input, customer }) => {
    const { ProjectModel: model } = await import('@alga-psa/projects/models');
    const { withTransaction } = await import('@alga-psa/db');
    const tenant = actor.tenant;
    await acceptCoManagedRelationship(db, actor, input);
    const status = await customer.table('statuses').where({ status_type: 'project', is_default: true }).first();
    const project = await model.create(db, tenant, { project_name: 'Model rollout', project_number: 'MODEL-1',
      client_id: operation.customer_client_id, status: status.status_id, wbs_code: '1' } as any);
    const phase = await model.addPhase(db, tenant, { project_id: project.project_id, phase_name: 'Model phase', wbs_code: '1.1', status: 'planning', order_number: 1 } as any);
    const custom = await model.addStatusToProject(db, tenant, project.project_id, { name: 'Review', status_type: 'project_task',
      item_type: 'project_task', order_number: 100, is_closed: false, is_default: false } as any);
    await model.updateProjectStatus(db, tenant, custom.status_id, { name: 'Customer review' }, { custom_name: 'Local review' });
    const mapping = (await model.getProjectStatusMappings(db, tenant, project.project_id))[0];
    const taskId = randomUUID();
    await customer.table('project_tasks').insert({ tenant, task_id: taskId, phase_id: phase.phase_id,
      task_name: 'Check rollout', wbs_code: '1.1.1', project_status_mapping_id: mapping.project_status_mapping_id, task_type_key: 'task' });
    await expect(withTransaction(db, async trx => {
      await model.update(trx, tenant, project.project_id, { project_name: 'Rolled back' });
      await model.copyProjectStatusMappingsToPhase(trx, tenant, project.project_id, phase.phase_id);
      throw new Error('Caller cancelled');
    })).rejects.toThrow('Caller cancelled');
    expect((await model.getById(db, tenant, project.project_id))?.project_name).toBe('Model rollout');
    expect(await model.getProjectStatusMappings(db, tenant, project.project_id, phase.phase_id)).toEqual([]);
    expect((await customer.table('project_tasks').where('task_id', taskId).first()).project_status_mapping_id).toBe(mapping.project_status_mapping_id);
    await expireCoManagedEntitlement(operation.tenant);
    expect(await model.getPhases(db, tenant, project.project_id)).toHaveLength(1);
    expect(await model.getProjectStatusMappings(db, tenant, project.project_id)).toHaveLength(1);
    await expect(model.delete(db, tenant, project.project_id)).rejects.toMatchObject({ code: 'CO_MANAGED_READ_ONLY' });
    expect(await customer.table('project_tasks')).toHaveLength(1);
    const entitlement = await tenantDb(db, operation.tenant).table('co_managed_entitlements').first();
    await reconcileHostedCoManagedEntitlement(db, operation.tenant, entitlement.source_reference,
      async () => ({ active: true, capacity: 2, validUntil: new Date(Date.now() + 3600000) }));
    const clones = await model.copyProjectStatusMappingsToPhase(db, tenant, project.project_id, phase.phase_id);
    expect(clones).toHaveLength(1);
    expect((await customer.table('project_tasks').where('task_id', taskId).first()).project_status_mapping_id).toBe(clones[0].project_status_mapping_id);
    await model.updateStructure(db, tenant, project.project_id, { phases: [{ phase_id: phase.phase_id, phase_name: 'Complete' }],
      tasks: [{ task_id: taskId, task_name: 'Verified' }] });
    expect((await model.getPhases(db, tenant, project.project_id))[0].phase_name).toBe('Complete');
    await model.delete(db, tenant, project.project_id);
    for (const table of ['projects', 'project_phases', 'project_tasks', 'project_status_mappings']) expect(await customer.table(table)).toEqual([]);
    await model.deleteProjectStatus(db, tenant, custom.status_id);
    expect(await customer.table('statuses').where('status_id', custom.status_id)).toEqual([]);
  }));
});

async function withProjectActionsFixture(work: (fixture: Awaited<ReturnType<typeof readyForAcceptance>> & {
  actions: typeof import('../../../../packages/projects/src/actions/projectActions');
  exports: typeof import('../../../../packages/projects/src/actions/projectTaskExportActions');
  publish: ReturnType<typeof vi.spyOn>;
  workflow: ReturnType<typeof vi.spyOn>;
}) => Promise<void>) {
  const fixture = await readyForAcceptance();
  const dbModule = await import('@alga-psa/db');
  const auth = await import('@alga-psa/auth');
  const events = await import('@alga-psa/event-bus/publishers');
  const adminDb = await import('@alga-psa/db/admin');
  const user = await fixture.customer.table('users').where('user_id', fixture.actor.userId).first();
  const workflow = vi.spyOn(events, 'publishWorkflowEvent').mockResolvedValue(undefined);
  const spies = [
    vi.spyOn(dbModule, 'createTenantKnex').mockResolvedValue({ knex: db, tenant: fixture.actor.tenant }),
    vi.spyOn(adminDb, 'getAdminConnection').mockResolvedValue(db),
    workflow,
  ];
  const publish = vi.spyOn(events, 'publishEvent').mockResolvedValue(undefined);
  try {
    const actions = await import('../../../../packages/projects/src/actions/projectActions');
    const exports = await import('../../../../packages/projects/src/actions/projectTaskExportActions');
    await auth.runWithApiKeyUser(user, () => runWithTenant(fixture.actor.tenant, () => work({ ...fixture, actions, exports, publish, workflow })));
  } finally { publish.mockRestore(); for (const spy of spies.reverse()) spy.mockRestore(); }
}

describe('co-managed project action lifecycle admission', () => {
  it('denies direct action mutations without changing project rows or publishing events', async () => withProjectActionsFixture(async ({ operation, actor, input, customer, actions, publish }) => {
    const id = randomUUID();
    const status = await customer.table('statuses').where({ status_type: 'project', is_default: true }).first();
    const data = { tenant: actor.tenant, project_name: 'Action project', client_id: operation.customer_client_id,
      status: status.status_id, description: null, start_date: null, end_date: null, is_inactive: false };
    const mutations = [
      () => actions.createProject(data),
      () => actions.updateProject(id, { project_name: 'Denied' }),
      () => actions.updatePhase(id, { phase_name: 'Denied' }),
      () => actions.markPhaseComplete(id),
      () => actions.reopenPhase(id),
      () => actions.deletePhase(id),
      () => actions.addProjectPhase({ project_id: id, phase_name: 'Denied', description: null, start_date: null, end_date: null, status: 'planning', order_number: 1, wbs_code: '' } as any),
      () => actions.reorderPhase(id),
      () => actions.updateProjectStructure(id, { phases: [], tasks: [] }),
      () => actions.addStatusToProject(id, {} as any),
      () => actions.updateProjectStatus(id, id, {}, {}),
      () => actions.deleteProjectStatus(id),
    ];
    for (const mutate of mutations) await expect(mutate()).rejects.toMatchObject({ code: 'CO_MANAGED_NOT_ACTIVE' });
    expect(await actions.deleteProject(id)).toMatchObject({ success: false });
    await acceptCoManagedRelationship(db, actor, input); await expireCoManagedEntitlement(operation.tenant);
    for (const mutate of mutations) await expect(mutate()).rejects.toMatchObject({ code: 'CO_MANAGED_READ_ONLY' });
    expect(await actions.deleteProject(id)).toMatchObject({ success: false });
    for (const table of ['projects', 'project_phases', 'project_status_mappings']) expect(await customer.table(table)).toEqual([]);
    expect(publish).not.toHaveBeenCalled();
  }));

  it('defers creation events through caller rollback and keeps tree reads and CSV exports available after expiry', async () => withProjectActionsFixture(async ({ operation, actor, input, customer, actions, exports, publish }) => {
    await acceptCoManagedRelationship(db, actor, input);
    const { withTransaction } = await import('@alga-psa/db');
    const status = await customer.table('statuses').where({ status_type: 'project', is_default: true }).first();
    const data = { tenant: actor.tenant, project_name: 'Action rollout', client_id: operation.customer_client_id,
      status: status.status_id, description: null, start_date: null, end_date: null, is_inactive: false };
    await expect(withTransaction(db, async trx => {
      const project = await actions.createProject(data, undefined, { trx });
      expect(project).toMatchObject({ project_name: 'Action rollout' });
      expect(publish).not.toHaveBeenCalled();
      throw new Error('Caller cancelled');
    })).rejects.toThrow('Caller cancelled');
    expect(await customer.table('projects')).toEqual([]); expect(publish).not.toHaveBeenCalled();
    const project = await actions.createProject(data) as any;
    expect(publish).toHaveBeenCalledOnce();
    const phase = await actions.addProjectPhase({ project_id: project.project_id, phase_name: 'Discovery',
      description: null, start_date: null, end_date: null, status: 'planning', order_number: 1, wbs_code: '' } as any) as any;
    expect(phase).toHaveProperty('phase_id');
    const mapping = await customer.table('project_status_mappings').where('project_id', project.project_id).first();
    await customer.table('project_tasks').insert({ tenant: actor.tenant, task_id: randomUUID(), phase_id: phase.phase_id,
      task_name: 'Customer inventory', task_type_key: 'task', wbs_code: '1.1.1', project_status_mapping_id: mapping.project_status_mapping_id });
    const completed = await actions.markPhaseComplete(phase.phase_id);
    expect(completed.phase.completed_at).not.toBeNull();
    expect((await actions.reopenPhase(phase.phase_id)).completed_at).toBeNull();
    // A legacy project without mappings must remain visible without read-time repair.
    const bareId = randomUUID();
    await customer.table('projects').insert({ tenant: actor.tenant, project_id: bareId, project_name: 'Legacy project',
      client_id: operation.customer_client_id, status: status.status_id, wbs_code: '99', project_number: 'LEGACY-99' });
    const barePhaseId = randomUUID();
    await customer.table('project_phases').insert({ tenant: actor.tenant, phase_id: barePhaseId, project_id: bareId,
      phase_name: 'Legacy phase', status: 'planning', order_number: 1, wbs_code: '99.1' });
    await expireCoManagedEntitlement(operation.tenant);
    const mappingCount = await customer.table('project_status_mappings').count('* as total').first();
    expect(await actions.getProjectTreeData(bareId)).toEqual([expect.objectContaining({ value: bareId, children: [expect.objectContaining({ value: barePhaseId, children: [] })] })]);
    expect(await customer.table('project_status_mappings').count('* as total').first()).toEqual(mappingCount);
    const result = await exports.exportProjectTasksToCSV(project.project_id, [phase.phase_id], ['task_name']);
    expect(result).toMatchObject({ count: 1, csv: expect.stringContaining('Customer inventory') });
    await expect(actions.markPhaseComplete(phase.phase_id)).rejects.toMatchObject({ code: 'CO_MANAGED_READ_ONLY' });
    expect((await customer.table('project_phases').where('phase_id', phase.phase_id).first()).completed_at).toBeNull();
  }));
});

describe('co-managed task model lifecycle admission', () => {
  it('denies every task, checklist, resource, ticket-link, type, and dependency mutation before acceptance and after expiry', async () => {
    const { operation, actor, input, customer } = await readyForAcceptance();
    const { ProjectTaskModel: model, TaskTypeModel: types, TaskDependencyModel: dependencies } = await import('@alga-psa/projects/models');
    const tenant = actor.tenant, id = randomUUID();
    const mutations = [
      () => model.addTask(db, tenant, id, {} as any),
      () => model.updateTask(db, tenant, id, {}),
      () => model.updateTaskStatus(db, tenant, id, id),
      () => model.deleteTask(db, tenant, id),
      () => model.reorderTasksInStatus(db, tenant, [{ taskId: id, newWbsCode: '1.1.9' }]),
      () => model.addChecklistItem(db, tenant, id, {} as any),
      () => model.updateChecklistItem(db, tenant, id, {}),
      () => model.deleteChecklistItem(db, tenant, id),
      () => model.deleteChecklistItems(db, tenant, id),
      () => model.addTaskResource(db, tenant, id, actor.userId),
      () => model.removeTaskResource(db, tenant, id),
      () => model.addTaskTicketLink(db, tenant, id, id, id, id),
      () => model.updateTaskTicketLink(db, tenant, id, { project_id: id, phase_id: id }),
      () => model.deleteTaskTicketLink(db, tenant, id),
      () => model.deleteTaskTicketLinksByTicketId(db, tenant, id),
      () => types.createCustomTaskType(db, tenant, {} as any),
      () => types.updateCustomTaskType(db, tenant, id, {}),
      () => types.deleteCustomTaskType(db, tenant, id),
      () => dependencies.addDependency(db, tenant, id, randomUUID(), 'blocks'),
      () => dependencies.updateDependency(db, tenant, id, {}),
      () => dependencies.removeDependency(db, tenant, id),
    ];
    for (const mutate of mutations) await expect(mutate()).rejects.toMatchObject({ code: 'CO_MANAGED_NOT_ACTIVE' });
    await acceptCoManagedRelationship(db, actor, input); await expireCoManagedEntitlement(operation.tenant);
    for (const mutate of mutations) await expect(mutate()).rejects.toMatchObject({ code: 'CO_MANAGED_READ_ONLY' });
    for (const table of ['project_tasks', 'task_checklist_items', 'task_resources', 'project_ticket_links']) expect(await customer.table(table)).toEqual([]);
  });

  it('preserves related records and reads during lapse, rolls back a caller transaction, and resumes mutations after renewal', async () => withProjectFixture(async ({ operation, actor, input, customer, service }) => {
    await acceptCoManagedRelationship(db, actor, input);
    const { ProjectModel, ProjectTaskModel: model } = await import('@alga-psa/projects/models');
    const { withTransaction } = await import('@alga-psa/db');
    const tenant = actor.tenant, context = { tenant, userId: actor.userId };
    const project = await service.create({ project_name: 'Task model rollout', client_id: operation.customer_client_id }, context);
    const phase = await service.createPhase(project.project_id, { phase_name: 'Discovery' } as any, context);
    const status = await customer.table('statuses').where({ status_type: 'project_task', is_default: true }).first();
    const mapping = await ProjectModel.addProjectStatusMapping(db, tenant, project.project_id, {
      status_id: status.status_id, is_standard: false, custom_name: null, display_order: 1, is_visible: true });
    const task = await model.addTask(db, tenant, phase.phase_id, { task_name: 'Inventory devices',
      project_status_mapping_id: mapping.project_status_mapping_id, task_type_key: 'task', assigned_to: actor.userId } as any);
    const checklist = await model.addChecklistItem(db, tenant, task.task_id, { item_name: 'Check inventory', completed: false,
      order_number: 1, description: null, assigned_to: null, due_date: null });
    const additionalUserId = randomUUID();
    await customer.table('users').insert({ tenant, user_id: additionalUserId, username: `tech-${additionalUserId}`,
      email: `tech-${additionalUserId}@example.test`, first_name: 'Additional', last_name: 'Technician',
      hashed_password: 'test-not-a-login', user_type: 'internal', is_inactive: false });
    await model.addTaskResource(db, tenant, task.task_id, additionalUserId, 'Reviewer');
    const resource = (await model.getTaskResources(db, tenant, task.task_id))[0];
    const ticketId = randomUUID();
    const ticketStatus = await customer.table('statuses').where({ board_id: operation.customer_board_id, item_type: 'ticket' }).first();
    const priority = await customer.table('priorities').where({ item_type: 'ticket' }).first();
    await customer.table('tickets').insert({ tenant, ticket_id: ticketId, ticket_number: 'MODEL-1', title: 'Rollout request',
      client_id: operation.customer_client_id, board_id: operation.customer_board_id, status_id: ticketStatus.status_id,
      priority_id: priority.priority_id, entered_by: actor.userId });
    const link = await model.addTaskTicketLink(db, tenant, project.project_id, task.task_id, ticketId, phase.phase_id);
    await expect(withTransaction(db, async trx => {
      await model.updateTask(trx, tenant, task.task_id, { task_name: 'Rolled back' });
      await model.updateChecklistItem(trx, tenant, checklist.checklist_item_id, { completed: true });
      await model.removeTaskResource(trx, tenant, resource.assignment_id);
      await model.deleteTaskTicketLink(trx, tenant, link.link_id);
      throw new Error('Caller cancelled');
    })).rejects.toThrow('Caller cancelled');
    await expireCoManagedEntitlement(operation.tenant);
    expect(await model.getTaskById(db, tenant, task.task_id)).toMatchObject({ task_name: 'Inventory devices' });
    expect(await model.getChecklistItems(db, tenant, task.task_id)).toEqual([expect.objectContaining({ completed: false })]);
    expect(await model.getTaskResources(db, tenant, task.task_id)).toHaveLength(1);
    expect(await model.getTaskTicketLinks(db, tenant, task.task_id)).toHaveLength(1);
    await expect(model.deleteTask(db, tenant, task.task_id)).rejects.toMatchObject({ code: 'CO_MANAGED_READ_ONLY' });
    for (const table of ['project_tasks', 'task_checklist_items', 'task_resources', 'project_ticket_links']) expect(await customer.table(table)).toHaveLength(1);
    const entitlement = await tenantDb(db, operation.tenant).table('co_managed_entitlements').first();
    await reconcileHostedCoManagedEntitlement(db, operation.tenant, entitlement.source_reference,
      async () => ({ active: true, capacity: 2, validUntil: new Date(Date.now() + 3600000) }));
    await model.updateTask(db, tenant, task.task_id, { task_name: 'Verified' });
    await model.updateTaskStatus(db, tenant, task.task_id, mapping.project_status_mapping_id);
    await model.reorderTasksInStatus(db, tenant, [{ taskId: task.task_id, newWbsCode: '1.1.9' }]);
    expect(await model.getTaskById(db, tenant, task.task_id)).toMatchObject({ task_name: 'Verified', wbs_code: '1.1.9' });
    await model.updateChecklistItem(db, tenant, checklist.checklist_item_id, { completed: true });
    expect((await model.getChecklistItems(db, tenant, task.task_id))[0].completed).toBe(true);
    await model.updateTaskTicketLink(db, tenant, link.link_id, { project_id: project.project_id, phase_id: phase.phase_id });
    await model.deleteTaskTicketLinksByTicketId(db, tenant, ticketId);
    await model.deleteTask(db, tenant, task.task_id);
    for (const table of ['project_tasks', 'task_checklist_items', 'task_resources', 'project_ticket_links']) expect(await customer.table(table)).toEqual([]);
  }));
});

it('preserves task configuration and dependencies through lapse and caller rollback, then permits renewal edits', async () => withProjectFixture(async ({ operation, actor, input, customer, service }) => {
  await acceptCoManagedRelationship(db, actor, input);
  const { ProjectModel, ProjectTaskModel, TaskTypeModel: types, TaskDependencyModel: dependencies } = await import('@alga-psa/projects/models');
  const { withTransaction } = await import('@alga-psa/db');
  const tenant = actor.tenant, context = { tenant, userId: actor.userId };
  const type = await types.createCustomTaskType(db, tenant, { type_key: 'customer_review', type_name: 'Customer review',
    display_order: 100, is_active: true });
  const project = await service.create({ project_name: 'Dependency rollout', client_id: operation.customer_client_id }, context);
  const phase = await service.createPhase(project.project_id, { phase_name: 'Discovery' } as any, context);
  const status = await customer.table('statuses').where({ status_type: 'project_task', is_default: true }).first();
  const mapping = await ProjectModel.addProjectStatusMapping(db, tenant, project.project_id, {
    status_id: status.status_id, is_standard: false, custom_name: null, display_order: 1, is_visible: true });
  const first = await ProjectTaskModel.addTask(db, tenant, phase.phase_id, { task_name: 'Prepare',
    task_type_key: type.type_key, project_status_mapping_id: mapping.project_status_mapping_id } as any);
  const second = await ProjectTaskModel.addTask(db, tenant, phase.phase_id, { task_name: 'Review',
    task_type_key: type.type_key, project_status_mapping_id: mapping.project_status_mapping_id } as any);
  const dependency = await dependencies.addDependency(db, tenant, first.task_id, second.task_id, 'blocks', 1, 'Await preparation');
  await expect(dependencies.addDependency(db, tenant, second.task_id, first.task_id, 'blocks')).rejects.toThrow(/circular|cycle/i);
  await expect(withTransaction(db, async trx => {
    await types.updateCustomTaskType(trx, tenant, type.type_id, { type_name: 'Rolled back' });
    await dependencies.updateDependency(trx, tenant, dependency.dependency_id, { notes: 'Rolled back' });
    throw new Error('Caller cancelled');
  })).rejects.toThrow('Caller cancelled');
  await expireCoManagedEntitlement(operation.tenant);
  expect(await types.getTaskTypeByKey(db, tenant, type.type_key)).toMatchObject({ type_name: 'Customer review' });
  expect((await dependencies.getTaskDependencies(db, tenant, first.task_id)).successors)
    .toEqual([expect.objectContaining({ notes: 'Await preparation', lead_lag_days: 1 })]);
  await expect(types.deleteCustomTaskType(db, tenant, type.type_id)).rejects.toMatchObject({ code: 'CO_MANAGED_READ_ONLY' });
  await expect(dependencies.removeDependency(db, tenant, dependency.dependency_id)).rejects.toMatchObject({ code: 'CO_MANAGED_READ_ONLY' });
  const entitlement = await tenantDb(db, operation.tenant).table('co_managed_entitlements').first();
  await reconcileHostedCoManagedEntitlement(db, operation.tenant, entitlement.source_reference,
    async () => ({ active: true, capacity: 2, validUntil: new Date(Date.now() + 3600000) }));
  await types.updateCustomTaskType(db, tenant, type.type_id, { type_name: 'Approval' });
  await dependencies.updateDependency(db, tenant, dependency.dependency_id, { notes: 'Approved', lead_lag_days: 2 });
  expect(await types.getTaskTypeByKey(db, tenant, type.type_key)).toMatchObject({ type_name: 'Approval' });
  expect((await dependencies.getTaskDependencies(db, tenant, first.task_id)).successors[0]).toMatchObject({ notes: 'Approved', lead_lag_days: 2 });
  await dependencies.removeDependency(db, tenant, dependency.dependency_id);
  await types.deleteCustomTaskType(db, tenant, type.type_id);
  expect(await customer.table('project_task_dependencies')).toEqual([]);
  expect(await customer.table('custom_task_types').where('type_id', type.type_id).first()).toMatchObject({ is_active: false });
}));

describe('co-managed project ordering recovery', () => {
  it('denies all standalone repair and regeneration services before acceptance and after expiry', async () => {
    const { operation, actor, input } = await readyForAcceptance();
    const ordering = await import('../../../../packages/projects/src/services/projectOrderingService');
    const id = randomUUID();
    const mutations = [
      () => ordering.regenerateTaskOrderKeys(db, actor.tenant, id, id),
      () => ordering.repairTaskOrderKeys(db, actor.tenant, id, id),
      () => ordering.regeneratePhaseOrderKeys(db, actor.tenant, id),
      () => ordering.repairPhaseOrderKeys(db, actor.tenant, id),
    ];
    for (const mutate of mutations) await expect(mutate()).rejects.toMatchObject({ code: 'CO_MANAGED_NOT_ACTIVE' });
    await acceptCoManagedRelationship(db, actor, input); await expireCoManagedEntitlement(operation.tenant);
    for (const mutate of mutations) await expect(mutate()).rejects.toMatchObject({ code: 'CO_MANAGED_READ_ONLY' });
  });

  it('repairs invalid task and phase keys inside the admitted action transaction without recursive actions', async () => withProjectActionsFixture(async ({ operation, actor, input, customer, actions }) => {
    await acceptCoManagedRelationship(db, actor, input);
    const taskActions = await import('../../../../packages/projects/src/actions/projectTaskActions');
    const { ProjectTaskModel } = await import('@alga-psa/projects/models');
    const dbModule = await import('@alga-psa/db');
    const ordering = await import('../../../../packages/projects/src/services/projectOrderingService');
    const status = await customer.table('statuses').where({ status_type: 'project', is_default: true }).first();
    const project = await actions.createProject({ tenant: actor.tenant, project_name: 'Ordering recovery',
      client_id: operation.customer_client_id, status: status.status_id, description: null, start_date: null,
      end_date: null, is_inactive: false }) as any;
    const phases: any[] = [];
    for (const name of ['First', 'Second', 'Moving']) {
      phases.push(await actions.addProjectPhase({ project_id: project.project_id, phase_name: name, description: null,
        start_date: null, end_date: null, status: 'planning', order_number: 1, wbs_code: '' } as any));
    }
    const mapping = await customer.table('project_status_mappings').where('project_id', project.project_id).first();
    const tasks: any[] = [];
    for (const [name, key] of [['First', '!'], ['Second', 'a2'], ['Moving', 'a3']]) {
      tasks.push(await ProjectTaskModel.addTask(db, actor.tenant, phases[0].phase_id, { task_name: name,
        task_type_key: 'task', project_status_mapping_id: mapping.project_status_mapping_id, order_key: key } as any));
    }
    vi.mocked(dbModule.createTenantKnex).mockClear();
    await taskActions.reorderTask(tasks[2].task_id, tasks[0].task_id, tasks[1].task_id);
    expect(dbModule.createTenantKnex).toHaveBeenCalledOnce();
    expect((await customer.table('project_tasks').orderBy('order_key')).map(row => row.task_name)).toEqual(['First', 'Moving', 'Second']);
    await customer.table('project_phases').where('phase_id', phases[0].phase_id).update({ order_key: '!' });
    vi.mocked(dbModule.createTenantKnex).mockClear();
    await actions.reorderPhase(phases[2].phase_id, phases[0].phase_id, phases[1].phase_id);
    expect(dbModule.createTenantKnex).toHaveBeenCalledOnce();
    expect((await customer.table('project_phases').orderBy('order_key')).map(row => row.phase_name)).toEqual(['First', 'Moving', 'Second']);
    // A singleton invalid key was missed by the former adjacent-pair validator.
    const lone = await ProjectTaskModel.addTask(db, actor.tenant, phases[1].phase_id, { task_name: 'Singleton',
      task_type_key: 'task', project_status_mapping_id: mapping.project_status_mapping_id, order_key: '!' } as any);
    await expect(dbModule.withTransaction(db, async trx => {
      expect(await ordering.repairTaskOrderKeys(trx, actor.tenant, phases[1].phase_id, mapping.project_status_mapping_id)).toBe(true);
      throw new Error('Caller cancelled');
    })).rejects.toThrow('Caller cancelled');
    expect((await customer.table('project_tasks').where('task_id', lone.task_id).first()).order_key).toBe('!');
    await expect(taskActions.reorderTask(tasks[2].task_id, lone.task_id)).resolves.toMatchObject({ actionError: expect.stringContaining('same phase and status') });
    const before = await customer.table('project_tasks').orderBy('task_id');
    await expireCoManagedEntitlement(operation.tenant);
    await expect(taskActions.reorderTask(tasks[2].task_id, tasks[0].task_id)).rejects.toMatchObject({ code: 'CO_MANAGED_READ_ONLY' });
    expect(await taskActions.cleanupOrderKeysForStatus(phases[1].phase_id, mapping.project_status_mapping_id)).toMatchObject({ success: false });
    expect(await customer.table('project_tasks').orderBy('task_id')).toEqual(before);
    const entitlement = await tenantDb(db, operation.tenant).table('co_managed_entitlements').first();
    await reconcileHostedCoManagedEntitlement(db, operation.tenant, entitlement.source_reference,
      async () => ({ active: true, capacity: 2, validUntil: new Date(Date.now() + 3600000) }));
    expect(await taskActions.cleanupOrderKeysForStatus(phases[1].phase_id, mapping.project_status_mapping_id)).toMatchObject({ success: true });
    expect((await customer.table('project_tasks').where('task_id', lone.task_id).first()).order_key).toBe('a0');
    expect(await ordering.repairTaskOrderKeys(db, actor.tenant, phases[1].phase_id, mapping.project_status_mapping_id)).toBe(false);
  }));
});

describe('co-managed task action lifecycle and publication', () => {
  it('denies task action mutations before acceptance and after expiry without emitting events', async () => withProjectActionsFixture(async ({ operation, actor, input, publish, workflow }) => {
    const actions = await import('../../../../packages/projects/src/actions/projectTaskActions');
    const id = randomUUID();
    const checklist = { tenant: actor.tenant, item_name: 'Check', description: null, assigned_to: null, completed: false, due_date: null, order_number: 1 };
    const mutations = [
      () => actions.updateTaskWithChecklist(id, { task_name: 'Denied' }),
      () => actions.addTaskToPhase(id, {} as any, []),
      () => actions.updateTaskStatus(id, id),
      () => actions.addChecklistItemToTask(id, checklist),
      () => actions.updateChecklistItem(id, { completed: true }),
      () => actions.deleteChecklistItem(id),
      () => actions.deleteTask(id),
      () => actions.addTicketLinkAction(id, id, id, id),
      () => actions.addTaskResourceAction(id, actor.userId),
      () => actions.addTaskResourcesAction(id, [actor.userId]),
      () => actions.assignTeamToProjectTask(id, id),
      () => actions.removeTeamFromProjectTask(id),
      () => actions.removeTaskResourceAction(id),
      () => actions.deleteTaskTicketLinkAction(id),
      () => actions.deleteTaskTicketLinksByTicketIdAction(id),
      () => actions.moveTaskToPhase(id, id),
      () => actions.duplicateTaskToPhase(id, id),
      () => actions.reorderTask(id),
      () => actions.reorderTasksInStatus([{ taskId: id, newWbsCode: '1.1.9' }]),
      () => actions.createCustomTaskType({} as any),
      () => actions.addTaskDependency(id, randomUUID(), 'blocks'),
      () => actions.removeTaskDependency(id),
      () => actions.updateTaskDependency(id, { notes: 'Denied' }),
    ];
    for (const mutate of mutations) await expect(mutate()).rejects.toMatchObject({ code: 'CO_MANAGED_NOT_ACTIVE' });
    await acceptCoManagedRelationship(db, actor, input); await expireCoManagedEntitlement(operation.tenant);
    for (const mutate of mutations) await expect(mutate()).rejects.toMatchObject({ code: 'CO_MANAGED_READ_ONLY' });
    expect(publish).not.toHaveBeenCalled(); expect(workflow).not.toHaveBeenCalled();
  }));

  it('publishes only committed tasks and checklists, preserves reads during lapse, and resumes edits after renewal', async () => withProjectActionsFixture(async ({ operation, actor, input, customer, actions: projects, publish, workflow }) => {
    await acceptCoManagedRelationship(db, actor, input);
    const actions = await import('../../../../packages/projects/src/actions/projectTaskActions');
    const status = await customer.table('statuses').where({ status_type: 'project', is_default: true }).first();
    const project = await projects.createProject({ tenant: actor.tenant, project_name: 'Task action rollout',
      client_id: operation.customer_client_id, status: status.status_id, description: null, start_date: null, end_date: null, is_inactive: false }) as any;
    const phase = await projects.addProjectPhase({ project_id: project.project_id, phase_name: 'Discovery', description: null,
      start_date: null, end_date: null, status: 'planning', order_number: 1, wbs_code: '' } as any) as any;
    const mapping = await customer.table('project_status_mappings').where('project_id', project.project_id).first();
    const data = { task_name: 'Inventory', task_type_key: 'task', project_status_mapping_id: mapping.project_status_mapping_id } as any;
    const checklist = { item_name: 'Verify devices', description: null, assigned_to: null, completed: false, due_date: null, order_number: 1 };
    publish.mockClear(); workflow.mockClear();
    expect(await actions.addTaskToPhase(phase.phase_id, data, [{ ...checklist, item_name: null } as any]))
      .toMatchObject({ actionError: expect.any(String) });
    expect(await customer.table('project_tasks')).toEqual([]);
    expect(publish).not.toHaveBeenCalled(); expect(workflow).not.toHaveBeenCalled();
    const publishedSnapshots: number[][] = [];
    workflow.mockImplementation(async () => { publishedSnapshots.push([
      (await customer.table('project_tasks')).length, (await customer.table('task_checklist_items')).length,
    ]); });
    const task = await actions.addTaskToPhase(phase.phase_id, data, [checklist]) as any;
    expect(task).toHaveProperty('task_id');
    expect(publishedSnapshots).toEqual([[1, 1]]);
    publish.mockClear(); workflow.mockClear();
    expect(await actions.updateTaskWithChecklist(task.task_id, { task_name: 'Rolled back',
      checklist_items: [{ ...checklist, item_name: null } as any] })).toMatchObject({ actionError: expect.any(String) });
    expect((await customer.table('project_tasks').where('task_id', task.task_id).first()).task_name).toBe('Inventory');
    expect(await customer.table('task_checklist_items')).toHaveLength(1);
    expect(publish).not.toHaveBeenCalled(); expect(workflow).not.toHaveBeenCalled();
    await expireCoManagedEntitlement(operation.tenant);
    expect(await actions.getTaskById(task.task_id)).toMatchObject({ task_name: 'Inventory' });
    expect(await actions.getTaskChecklistItems(task.task_id)).toEqual([expect.objectContaining({ item_name: 'Verify devices' })]);
    expect(await actions.bulkAddTagsToTasks([task.task_id], ['Blocked tag'])).toMatchObject({ updatedIds: [], failed: [expect.objectContaining({ taskId: task.task_id })] });
    expect(await customer.table('tag_mappings')).toEqual([]);
    expect(publish).not.toHaveBeenCalled();
    const entitlement = await tenantDb(db, operation.tenant).table('co_managed_entitlements').first();
    await reconcileHostedCoManagedEntitlement(db, operation.tenant, entitlement.source_reference,
      async () => ({ active: true, capacity: 2, validUntil: new Date(Date.now() + 3600000) }));
    const namesAtPublication: string[] = [];
    publish.mockImplementation(async () => { namesAtPublication.push((await customer.table('project_tasks').where('task_id', task.task_id).first()).task_name); });
    expect(await actions.updateTaskWithChecklist(task.task_id, { task_name: 'Verified', checklist_items: [{ ...checklist, completed: true } as any] }))
      .toMatchObject({ task_name: 'Verified' });
    expect(namesAtPublication).toEqual(['Verified']);
    expect((await customer.table('task_checklist_items').first()).completed).toBe(true);
  }));
});

describe('co-managed project status action lifecycle', () => {
  it('denies all status library and mapping mutations before acceptance and after expiry', async () => withProjectActionsFixture(async ({ operation, actor, input }) => {
    const actions = await import('../../../../packages/projects/src/actions/projectTaskStatusActions');
    const id = randomUUID();
    const mutations = [
      () => actions.addStatusToProject(id, { status_id: id }),
      () => actions.copyProjectStatusesToPhase(id, id),
      () => actions.removePhaseStatuses(id),
      () => actions.updateProjectStatusMapping(id, { custom_name: 'Denied' }),
      () => actions.deleteProjectStatusMapping(id),
      () => actions.reorderProjectStatuses(id, [{ mapping_id: id, display_order: 1 }]),
      () => actions.createTenantProjectStatus({ name: 'Denied', is_closed: false }),
      () => actions.updateTenantProjectStatus(id, { name: 'Denied' }),
      () => actions.deleteTenantProjectStatus(id),
      () => actions.reorderTenantProjectStatuses([{ status_id: id, order_number: 1 }]),
    ];
    for (const mutate of mutations) await expect(mutate()).rejects.toMatchObject({ code: 'CO_MANAGED_NOT_ACTIVE' });
    await acceptCoManagedRelationship(db, actor, input); await expireCoManagedEntitlement(operation.tenant);
    for (const mutate of mutations) await expect(mutate()).rejects.toMatchObject({ code: 'CO_MANAGED_READ_ONLY' });
  }));

  it('preserves mapping reads during expiry and resumes status swaps, phase remapping, and deletion after renewal', async () => withProjectActionsFixture(async ({ operation, actor, input, customer, actions: projects }) => {
    await acceptCoManagedRelationship(db, actor, input);
    const actions = await import('../../../../packages/projects/src/actions/projectTaskStatusActions');
    const { ProjectTaskModel } = await import('@alga-psa/projects/models');
    const projectStatus = await customer.table('statuses').where({ status_type: 'project', is_default: true }).first();
    const project = await projects.createProject({ tenant: actor.tenant, project_name: 'Status rollout', client_id: operation.customer_client_id,
      status: projectStatus.status_id, description: null, start_date: null, end_date: null, is_inactive: false }) as any;
    const phase = await projects.addProjectPhase({ project_id: project.project_id, phase_name: 'Discovery', description: null,
      start_date: null, end_date: null, status: 'planning', order_number: 1, wbs_code: '' } as any) as any;
    const custom = await actions.createTenantProjectStatus({ name: 'Customer review', is_closed: false }) as any;
    expect(custom).toHaveProperty('status_id');
    const added = await actions.addStatusToProject(project.project_id, { status_id: custom.status_id }) as any;
    expect(added).toHaveProperty('project_status_mapping_id');
    const task = await ProjectTaskModel.addTask(db, actor.tenant, phase.phase_id, { task_name: 'Review rollout', task_type_key: 'task',
      project_status_mapping_id: added.project_status_mapping_id } as any);
    const phaseMappings = await actions.copyProjectStatusesToPhase(project.project_id, phase.phase_id) as any[];
    const clone = phaseMappings.find(mapping => mapping.status_id === custom.status_id);
    expect((await customer.table('project_tasks').where('task_id', task.task_id).first()).project_status_mapping_id).toBe(clone.project_status_mapping_id);
    await actions.updateProjectStatusMapping(clone.project_status_mapping_id, { custom_name: 'Phase review' });
    expect(await actions.deleteProjectStatusMapping(clone.project_status_mapping_id, added.project_status_mapping_id))
      .toMatchObject({ actionError: expect.stringContaining('same project and phase scope') });
    expect((await customer.table('project_tasks').where('task_id', task.task_id).first()).project_status_mapping_id).toBe(clone.project_status_mapping_id);
    await expireCoManagedEntitlement(operation.tenant);
    expect(await actions.getProjectStatusMappings(project.project_id, phase.phase_id))
      .toEqual(expect.arrayContaining([expect.objectContaining({ custom_name: 'Phase review' })]));
    expect(await actions.getStatusMappingTaskCount(clone.project_status_mapping_id)).toBe(1);
    expect(await actions.validateTenantProjectStatusDeletion(custom.status_id)).toMatchObject({ canDelete: false });
    await expect(actions.removePhaseStatuses(phase.phase_id)).rejects.toMatchObject({ code: 'CO_MANAGED_READ_ONLY' });
    expect((await customer.table('project_tasks').where('task_id', task.task_id).first()).project_status_mapping_id).toBe(clone.project_status_mapping_id);
    const entitlement = await tenantDb(db, operation.tenant).table('co_managed_entitlements').first();
    await reconcileHostedCoManagedEntitlement(db, operation.tenant, entitlement.source_reference,
      async () => ({ active: true, capacity: 2, validUntil: new Date(Date.now() + 3600000) }));
    await actions.updateTenantProjectStatus(custom.status_id, { name: 'Approved review' });
    const library = await customer.table('statuses').where({ status_type: 'project_task' }).orderBy('order_number');
    const order = [{ status_id: library[0].status_id, order_number: library[1].order_number },
      { status_id: library[1].status_id, order_number: library[0].order_number }];
    expect(await actions.reorderTenantProjectStatuses(order)).toBeUndefined();
    expect((await customer.table('statuses').where('status_id', library[0].status_id).first()).order_number).toBe(library[1].order_number);
    const afterSwap = await customer.table('statuses').where({ status_type: 'project_task' }).orderBy('status_id');
    expect(await actions.reorderTenantProjectStatuses([order[0], order[0]])).toMatchObject({ actionError: expect.any(String) });
    expect(await customer.table('statuses').where({ status_type: 'project_task' }).orderBy('status_id')).toEqual(afterSwap);
    await actions.removePhaseStatuses(phase.phase_id);
    expect((await customer.table('project_tasks').where('task_id', task.task_id).first()).project_status_mapping_id).toBe(added.project_status_mapping_id);
    const otherMapping = await customer.table('project_status_mappings').where('project_id', project.project_id)
      .whereNot('project_status_mapping_id', added.project_status_mapping_id).first();
    await actions.deleteProjectStatusMapping(added.project_status_mapping_id, otherMapping.project_status_mapping_id);
    expect((await customer.table('project_tasks').where('task_id', task.task_id).first()).project_status_mapping_id).toBe(otherMapping.project_status_mapping_id);
    await actions.deleteTenantProjectStatus(custom.status_id);
    expect(await customer.table('statuses').where('status_id', custom.status_id)).toEqual([]);
  }));
});

describe('co-managed task comments and reactions', () => {
  it('denies comment and reaction mutations before acceptance and after expiry', async () => withProjectActionsFixture(async ({ operation, actor, input, publish }) => {
    const comments = await import('../../../../packages/projects/src/actions/projectTaskCommentActions');
    const reactions = await import('../../../../packages/projects/src/actions/projectTaskCommentReactionActions');
    const id = randomUUID();
    const mutations = [
      () => comments.createTaskComment({ taskId: id, note: 'Denied' }),
      () => comments.updateTaskComment(id, { note: 'Denied' }),
      () => comments.deleteTaskComment(id),
      () => reactions.toggleTaskCommentReaction(id, '👍'),
    ];
    for (const mutate of mutations) await expect(mutate()).rejects.toMatchObject({ code: 'CO_MANAGED_NOT_ACTIVE' });
    await acceptCoManagedRelationship(db, actor, input); await expireCoManagedEntitlement(operation.tenant);
    for (const mutate of mutations) await expect(mutate()).rejects.toMatchObject({ code: 'CO_MANAGED_READ_ONLY' });
    expect(publish).not.toHaveBeenCalled();
  }));

  it('keeps threaded comments and reactions atomic, publishes after commit, and resumes after renewal', async () => withProjectActionsFixture(async ({ operation, actor, input, customer, actions: projects, publish }) => {
    await acceptCoManagedRelationship(db, actor, input);
    const comments = await import('../../../../packages/projects/src/actions/projectTaskCommentActions');
    const reactions = await import('../../../../packages/projects/src/actions/projectTaskCommentReactionActions');
    const dbModule = await import('@alga-psa/db');
    const { ProjectTaskModel } = await import('@alga-psa/projects/models');
    const status = await customer.table('statuses').where({ status_type: 'project', is_default: true }).first();
    const project = await projects.createProject({ tenant: actor.tenant, project_name: 'Comment rollout', client_id: operation.customer_client_id,
      status: status.status_id, description: null, start_date: null, end_date: null, is_inactive: false }) as any;
    const phase = await projects.addProjectPhase({ project_id: project.project_id, phase_name: 'Discovery', description: null,
      start_date: null, end_date: null, status: 'planning', order_number: 1, wbs_code: '' } as any) as any;
    const mapping = await customer.table('project_status_mappings').where('project_id', project.project_id).first();
    const task = await ProjectTaskModel.addTask(db, actor.tenant, phase.phase_id, { task_name: 'Discuss rollout', task_type_key: 'task',
      project_status_mapping_id: mapping.project_status_mapping_id } as any);
    publish.mockClear();
    // The authenticated action may inherit a caller transaction. Its events must
    // stay deferred through the caller's decision to roll back.
    await expect(dbModule.withTransaction(db, async trx => {
      vi.mocked(dbModule.createTenantKnex).mockResolvedValueOnce({ knex: trx, tenant: actor.tenant });
      expect(await comments.createTaskComment({ taskId: task.task_id, note: 'Cancelled' })).toEqual(expect.any(String));
      expect(publish).not.toHaveBeenCalled();
      throw new Error('Caller cancelled comment');
    })).rejects.toThrow('Caller cancelled comment');
    expect(await customer.table('project_task_comments')).toEqual([]);
    expect(await customer.table('comment_threads')).toEqual([]);
    expect(publish).not.toHaveBeenCalled();
    const snapshots: any[] = [];
    publish.mockImplementation(async (event: any) => {
      snapshots.push(await customer.table('project_task_comments').where('task_comment_id', event.payload.taskCommentId).first());
    });
    const root = await comments.createTaskComment({ taskId: task.task_id, note: 'Customer question' }) as string;
    expect(snapshots).toEqual([expect.objectContaining({ note: 'Customer question' }), expect.objectContaining({ note: 'Customer question' })]);
    const reply = await comments.createTaskComment({ taskId: task.task_id, note: 'Answer', parentCommentId: root }) as string;
    expect((await customer.table('comment_threads').first()).reply_count).toBe(1);
    expect(await reactions.toggleTaskCommentReaction(reply, '👍')).toEqual({ added: true });
    await expireCoManagedEntitlement(operation.tenant);
    expect(await comments.getTaskCommentCount(task.task_id)).toBe(2);
    const reactionRead = await reactions.getTaskCommentsReactionsBatch([reply]);
    expect(reactionRead.reactions[reply]).toEqual([expect.objectContaining({ emoji: '👍', count: 1 })]);
    const before = await customer.table('project_task_comments').orderBy('task_comment_id');
    publish.mockClear();
    await expect(comments.deleteTaskComment(root)).rejects.toMatchObject({ code: 'CO_MANAGED_READ_ONLY' });
    await expect(reactions.toggleTaskCommentReaction(reply, '👍')).rejects.toMatchObject({ code: 'CO_MANAGED_READ_ONLY' });
    expect(await customer.table('project_task_comments').orderBy('task_comment_id')).toEqual(before);
    expect(await customer.table('project_task_comment_reactions')).toHaveLength(1);
    expect(publish).not.toHaveBeenCalled();
    const entitlement = await tenantDb(db, operation.tenant).table('co_managed_entitlements').first();
    await reconcileHostedCoManagedEntitlement(db, operation.tenant, entitlement.source_reference,
      async () => ({ active: true, capacity: 2, validUntil: new Date(Date.now() + 3600000) }));
    snapshots.length = 0;
    await comments.updateTaskComment(reply, { note: 'Revised answer' });
    expect(snapshots).toEqual([expect.objectContaining({ note: 'Revised answer' }), expect.objectContaining({ note: 'Revised answer' })]);
    await comments.deleteTaskComment(root);
    expect((await customer.table('project_task_comments').where('task_comment_id', root).first()).deleted_at).not.toBeNull();
    await comments.deleteTaskComment(reply);
    expect(await customer.table('project_task_comment_reactions')).toEqual([]);
    expect((await customer.table('comment_threads').first()).reply_count).toBe(0);
    await comments.deleteTaskComment(root);
    expect(await customer.table('project_task_comments')).toEqual([]);
    expect(await customer.table('comment_threads')).toEqual([]);
  }));
});

describe('co-managed project templates and import', () => {
  it('denies every template mutation, the application service, and CSV import while inactive', async () => withProjectActionsFixture(async ({ operation, actor, input, publish, workflow }) => {
    const templates = await import('../../../../packages/projects/src/actions/projectTemplateActions');
    const wizard = await import('../../../../packages/projects/src/actions/projectTemplateWizardActions');
    const importer = await import('../../../../packages/projects/src/actions/phaseTaskImportActions');
    const { applyProjectTemplate } = await import('../../../../packages/projects/src/services/applyProjectTemplate');
    const { replaceTemplateStatusMappingCore } = await import('../../../../packages/projects/src/lib/projectTemplateStatusMappingResolution');
    const { withTransaction } = await import('@alga-psa/db');
    const id = randomUUID();
    const data = { template_name: 'Denied', phases: [], tasks: [], status_mappings: [], checklist_items: [] };
    const projectData = { project_name: 'Denied', client_id: operation.customer_client_id };
    const mutations = [
      () => templates.createTemplateFromProject(id, { template_name: 'Denied' }),
      () => templates.applyTemplate(id, projectData),
      () => templates.updateTemplate(id, { template_name: 'Denied' }),
      () => templates.deleteTemplate(id),
      () => templates.duplicateTemplate(id),
      () => templates.addTemplateDependency(id, id, randomUUID(), 'blocks'),
      () => templates.updateTemplateDependency(id, { notes: 'Denied' }),
      () => templates.removeTemplateDependency(id),
      () => templates.addTemplatePhase(id, { phase_name: 'Denied' }),
      () => templates.updateTemplatePhase(id, { phase_name: 'Denied' }),
      () => templates.deleteTemplatePhase(id),
      () => templates.reorderTemplatePhase(id, null, null),
      () => templates.addTemplateTask(id, { task_name: 'Denied' }),
      () => templates.updateTemplateTask(id, { task_name: 'Denied' }),
      () => templates.deleteTemplateTask(id),
      () => templates.moveTemplateTask(id, id),
      () => templates.updateTemplateTaskStatus(id, id),
      () => templates.addTemplateStatusMapping(id, { status_id: id }),
      () => templates.replaceTemplateStatusMapping(id, id, { type: 'tenant', statusId: id }),
      () => templates.removeTemplateStatusMapping(id),
      () => templates.reorderTemplateStatusMappings(id, [id]),
      () => templates.copyTemplateStatusesToPhase(id, id),
      () => templates.removeTemplatePhaseStatuses(id, id),
      () => templates.setTaskAdditionalAgents(id, [actor.userId]),
      () => templates.addTaskAdditionalAgent(id, actor.userId),
      () => templates.removeTaskAdditionalAgent(id, actor.userId),
      () => templates.addTemplateChecklistItem(id, { item_name: 'Denied' }),
      () => templates.updateTemplateChecklistItem(id, { item_name: 'Denied' }),
      () => templates.deleteTemplateChecklistItem(id),
      () => templates.saveTemplateChecklistItems(id, []),
      () => wizard.createTemplateFromWizard(data),
      () => wizard.updateTemplateFromEditor(id, data),
      () => wizard.saveTemplateAsNew(id, 'Denied'),
      () => withTransaction(db, trx => applyProjectTemplate(trx, actor.tenant, id, projectData)),
      () => withTransaction(db, trx => replaceTemplateStatusMappingCore(trx, actor.tenant, id, id, { type: 'tenant', statusId: id })),
    ];
    for (const mutate of mutations) await expect(mutate()).rejects.toMatchObject({ code: 'CO_MANAGED_NOT_ACTIVE' });
    expect(await importer.importPhasesAndTasks(id, [])).toMatchObject({ success: false, phasesCreated: 0, tasksCreated: 0 });
    await acceptCoManagedRelationship(db, actor, input); await expireCoManagedEntitlement(operation.tenant);
    for (const mutate of mutations) await expect(mutate()).rejects.toMatchObject({ code: 'CO_MANAGED_READ_ONLY' });
    expect(await importer.importPhasesAndTasks(id, [])).toMatchObject({ success: false, phasesCreated: 0, tasksCreated: 0 });
    expect(publish).not.toHaveBeenCalled(); expect(workflow).not.toHaveBeenCalled();
  }));

  it('creates and applies wizard templates atomically, preserves lapse reads, and resumes imports after renewal', async () => withProjectActionsFixture(async ({ operation, actor, input, customer, publish, workflow }) => {
    await acceptCoManagedRelationship(db, actor, input);
    const templates = await import('../../../../packages/projects/src/actions/projectTemplateActions');
    const wizard = await import('../../../../packages/projects/src/actions/projectTemplateWizardActions');
    const importer = await import('../../../../packages/projects/src/actions/phaseTaskImportActions');
    const dbModule = await import('@alga-psa/db');
    const status = await customer.table('statuses').where({ status_type: 'project_task', is_closed: false }).first();
    const data = { template_name: 'Customer rollout',
      phases: [{ temp_id: 'phase', phase_name: 'Discovery', start_offset_days: 0, order_number: 1 }],
      status_mappings: [{ temp_id: 'status', status_id: status.status_id, display_order: 1 }],
      tasks: [{ temp_id: 'task', phase_temp_id: 'phase', task_name: 'Inventory', task_type_key: 'task', template_status_mapping_id: 'status', order_number: 1 }],
      checklist_items: [{ temp_id: 'check', task_temp_id: 'task', item_name: 'Verify', order_number: 1, completed: false }],
    };
    const templateId = await wizard.createTemplateFromWizard(data) as string;
    expect(templateId).toEqual(expect.any(String));
    const templatePhases = await customer.table('project_template_phases').where('template_id', templateId);
    const templateTasks = await customer.table('project_template_tasks').whereIn('template_phase_id', templatePhases.map(row => row.template_phase_id));
    expect(templateTasks).toHaveLength(1);
    expect(await customer.table('project_template_checklist_items').where('template_task_id', templateTasks[0].template_task_id)).toHaveLength(1);
    const projectData = { project_name: 'Applied rollout', client_id: operation.customer_client_id };
    await expect(dbModule.withTransaction(db, async trx => {
      vi.mocked(dbModule.createTenantKnex).mockResolvedValueOnce({ knex: trx, tenant: actor.tenant });
      expect(await templates.applyTemplate(templateId, projectData)).toEqual(expect.any(String));
      expect(publish).not.toHaveBeenCalled();
      throw new Error('Caller cancelled template application');
    })).rejects.toThrow('Caller cancelled template application');
    expect(await customer.table('projects')).toEqual([]);
    expect(await customer.table('project_tasks')).toEqual([]);
    expect((await customer.table('project_templates').where('template_id', templateId).first()).use_count).toBe(0);
    expect(publish).not.toHaveBeenCalled();
    const publishedProjects: any[] = [];
    publish.mockImplementation(async (event: any) => {
      publishedProjects.push(await customer.table('projects').where('project_id', event.payload.projectId).first());
    });
    const projectId = await templates.applyTemplate(templateId, projectData) as string;
    expect(publishedProjects).toEqual([expect.objectContaining({ project_id: projectId })]);
    expect(await customer.table('project_tasks')).toHaveLength(1);
    expect(await customer.table('task_checklist_items')).toHaveLength(1);
    const rows = [{ phase_name: 'CSV phase', tasks: [{ task_name: 'CSV task', task_type_key: 'task', tags: [] }] }] as any;
    await expect(dbModule.withTransaction(db, async trx => {
      vi.mocked(dbModule.createTenantKnex).mockResolvedValueOnce({ knex: trx, tenant: actor.tenant });
      expect(await importer.importPhasesAndTasks(projectId, rows)).toMatchObject({ success: true, phasesCreated: 1, tasksCreated: 1 });
      expect(workflow).not.toHaveBeenCalled();
      throw new Error('Caller cancelled import');
    })).rejects.toThrow('Caller cancelled import');
    expect(await customer.table('project_tasks')).toHaveLength(1);
    expect(workflow).not.toHaveBeenCalled();
    await expireCoManagedEntitlement(operation.tenant);
    expect(await templates.getTemplates()).toEqual(expect.arrayContaining([expect.objectContaining({ template_id: templateId })]));
    expect(await templates.getTemplateWithDetails(templateId)).toMatchObject({ template_name: data.template_name });
    expect(await importer.getImportReferenceData(projectId)).toHaveProperty('phases');
    expect(await importer.importPhasesAndTasks(projectId, rows)).toMatchObject({ success: false, phasesCreated: 0, tasksCreated: 0 });
    expect(await customer.table('project_tasks')).toHaveLength(1);
    const entitlement = await tenantDb(db, operation.tenant).table('co_managed_entitlements').first();
    await reconcileHostedCoManagedEntitlement(db, operation.tenant, entitlement.source_reference,
      async () => ({ active: true, capacity: 2, validUntil: new Date(Date.now() + 3600000) }));
    const publishedTasks: any[] = [];
    workflow.mockImplementation(async (event: any) => {
      publishedTasks.push(await customer.table('project_tasks').where('task_id', event.payload.taskId).first());
    });
    expect(await importer.importPhasesAndTasks(projectId, rows)).toMatchObject({ success: true, phasesCreated: 1, tasksCreated: 1 });
    expect(publishedTasks).toEqual([expect.objectContaining({ task_name: 'CSV task' })]);
    expect(await templates.updateTemplate(templateId, { template_name: 'Renewed rollout' })).toMatchObject({ template_name: 'Renewed rollout' });
    const templateMapping = await customer.table('project_template_status_mappings').where('template_id', templateId).first();
    expect(await templates.replaceTemplateStatusMapping(templateId, templateMapping.template_status_mapping_id, { type: 'tenant', statusId: status.status_id }))
      .toMatchObject({ mapping: { status_id: status.status_id }, unresolvedStatusMappingCount: 0 });
  }));
});

it('keeps client portal task uploads atomic when expiry wins during transport and preserves document reads', async () => withProjectActionsFixture(async ({ operation, actor, input, customer, actions: projects, workflow }) => {
  await acceptCoManagedRelationship(db, actor, input);
  const auth = await import('@alga-psa/auth');
  const portal = await import('../../../../packages/client-portal/src/actions/client-portal-actions/client-project-details');
  const { ProjectTaskModel } = await import('@alga-psa/projects/models');
  const status = await customer.table('statuses').where({ status_type: 'project', is_default: true }).first();
  const project = await projects.createProject({ tenant: actor.tenant, project_name: 'Portal upload', client_id: operation.customer_client_id,
    status: status.status_id, description: null, start_date: null, end_date: null, is_inactive: false }) as any;
  await customer.table('projects').where('project_id', project.project_id).update({ client_portal_config: {
    show_tasks: true, visible_task_fields: ['task_name', 'document_uploads'],
  } });
  const phase = await projects.addProjectPhase({ project_id: project.project_id, phase_name: 'Discovery', description: null,
    start_date: null, end_date: null, status: 'planning', order_number: 1, wbs_code: '' } as any) as any;
  const mapping = await customer.table('project_status_mappings').where('project_id', project.project_id).first();
  const task = await ProjectTaskModel.addTask(db, actor.tenant, phase.phase_id, { task_name: 'Attach inventory', task_type_key: 'task',
    project_status_mapping_id: mapping.project_status_mapping_id } as any);
  const contact = await customer.table('contacts').where('client_id', operation.customer_client_id).first();
  const [requester] = await customer.table('users').insert({ tenant: actor.tenant, user_id: randomUUID(), username: `portal-${randomUUID()}`,
    email: 'portal@example.test', first_name: 'Portal', last_name: 'Requester', hashed_password: 'not-a-login',
    user_type: 'client', contact_id: contact.contact_name_id, is_inactive: false }).returning('*');
  const form = new FormData(); form.set('file', new File(['saved'], 'saved.txt', { type: 'text/plain' }));
  const upload = () => auth.runWithApiKeyUser(requester, () => portal.uploadClientTaskDocument(task.task_id, form));
  artifactStorage.upload.mockReset().mockImplementation(async (buffer, path) => ({ path, size: buffer.length, mime_type: 'text/plain' }));
  artifactStorage.delete.mockReset().mockResolvedValue(undefined);
  workflow.mockClear();
  artifactStorage.upload.mockImplementationOnce(async (_buffer, path) => {
    await expireCoManagedEntitlement(operation.tenant);
    return { path, size: 5, mime_type: 'text/plain' };
  });
  expect(await upload()).toMatchObject({ success: false });
  for (const table of ['external_files', 'documents', 'document_associations']) expect(await customer.table(table)).toEqual([]);
  expect(artifactStorage.delete).toHaveBeenCalledOnce();
  expect(workflow).not.toHaveBeenCalled();
  const entitlement = await tenantDb(db, operation.tenant).table('co_managed_entitlements').first();
  await reconcileHostedCoManagedEntitlement(db, operation.tenant, entitlement.source_reference,
    async () => ({ active: true, capacity: 2, validUntil: new Date(Date.now() + 3600000) }));
  const observed: number[] = [];
  workflow.mockImplementation(async () => {
    observed.push((await customer.table('document_associations').where({ entity_type: 'project_task', entity_id: task.task_id })).length);
  });
  const result = await upload();
  expect(result).toMatchObject({ success: true, documentId: expect.any(String) });
  expect(observed.length).toBeGreaterThan(0); expect(observed.every(count => count === 1)).toBe(true);
  expect(await customer.table('external_files')).toHaveLength(1);
  expect(await customer.table('documents')).toEqual([expect.objectContaining({ created_by: requester.user_id, is_client_visible: true })]);
  await expireCoManagedEntitlement(operation.tenant);
  const uploads = artifactStorage.upload.mock.calls.length;
  expect(await upload()).toMatchObject({ success: false });
  expect(artifactStorage.upload.mock.calls).toHaveLength(uploads);
  expect(await auth.runWithApiKeyUser(requester, () => portal.getClientTaskDocuments(task.task_id)))
    .toMatchObject({ success: true, documents: [expect.objectContaining({ document_name: 'saved.txt' })] });
}));

it('admits project status email at send time while retaining previews during pending acceptance and lapse', async () => withProjectActionsFixture(async ({ operation, actor, input, customer }) => {
  const actions = await import('../../../../packages/projects/src/actions/projectStatusUpdateActions');
  const dbModule = await import('@alga-psa/db');
  const connection = vi.spyOn(dbModule, 'getConnection').mockResolvedValue(db);
  statusEmail.create.mockReset().mockResolvedValue({ sendEmail: statusEmail.send });
  statusEmail.send.mockReset().mockResolvedValue(undefined);
  try {
    const projectId = randomUUID();
    const status = await customer.table('statuses').where({ status_type: 'project', is_default: true }).first();
    const contact = await customer.table('contacts').where('client_id', operation.customer_client_id).first();
    await customer.table('projects').insert({ tenant: actor.tenant, project_id: projectId, project_name: 'Customer rollout',
      client_id: operation.customer_client_id, contact_name_id: contact.contact_name_id, status: status.status_id,
      project_number: 'MAIL-1', wbs_code: '1', client_portal_config: { show_tasks: true, show_phases: true, show_budget_hours: false } });
    await customer.table('tenant_email_templates').insert({ tenant: actor.tenant, name: 'project-status-update', language_code: 'en',
      subject: '{{project.name}} update', html_content: '<p>{{customMessage}}</p>', text_content: '{{customMessage}}' });
    expect(await actions.getProjectStatusUpdateRecipient(projectId)).toMatchObject({ projectId, recipientEmail: contact.email });
    expect(await actions.sendProjectStatusUpdate(projectId, 'Ready')).toMatchObject({ actionError: expect.any(String) });
    expect(statusEmail.send).not.toHaveBeenCalled();
    await acceptCoManagedRelationship(db, actor, input);
    expect(await actions.sendProjectStatusUpdate(projectId, 'Ready')).toMatchObject({ recipientEmail: contact.email });
    expect(statusEmail.send).toHaveBeenCalledWith(expect.objectContaining({ subject: 'Customer rollout update', text: 'Ready' }), actor.tenant);
    statusEmail.send.mockClear();
    // Expiry after the UI preview, while preparing a provider, must still stop
    // transmission. An initial request-time check alone would miss this race.
    statusEmail.create.mockImplementationOnce(async () => {
      await expireCoManagedEntitlement(operation.tenant);
      return { sendEmail: statusEmail.send };
    });
    expect(await actions.sendProjectStatusUpdate(projectId, 'Blocked')).toMatchObject({ actionError: expect.any(String) });
    expect(statusEmail.send).not.toHaveBeenCalled();
    expect(await actions.getProjectStatusUpdateRecipient(projectId)).toMatchObject({ projectId, recipientEmail: contact.email });
    expect(await actions.sendProjectStatusUpdate(projectId, 'Still blocked')).toMatchObject({ actionError: expect.any(String) });
    expect(statusEmail.send).not.toHaveBeenCalled();
    const entitlement = await tenantDb(db, operation.tenant).table('co_managed_entitlements').first();
    await reconcileHostedCoManagedEntitlement(db, operation.tenant, entitlement.source_reference,
      async () => ({ active: true, capacity: 2, validUntil: new Date(Date.now() + 3600000) }));
    expect(await actions.sendProjectStatusUpdate(projectId, 'Renewed')).toMatchObject({ recipientEmail: contact.email });
    expect(statusEmail.send).toHaveBeenCalledOnce();
  } finally { connection.mockRestore(); }
}));

describe('co-managed KB article API lifecycle', () => {
  it('denies every article mutation during pending acceptance and lapse while preserving article and content reads', async () => {
    const { operation, actor, input } = await readyForAcceptance();
    const { KbArticleService } = await import('../../lib/api/services/KbArticleService');
    const service = new KbArticleService();
    vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: db });
    const context = { tenant: actor.tenant, userId: actor.userId };
    let id = randomUUID();
    const data = { title: 'Customer guide', article_type: 'how_to' as const, audience: 'client' as const, content: '# Guide', content_format: 'markdown' as const };
    const mutations = [
      () => service.create(data, context),
      () => service.update(id, { title: 'Denied' }, context),
      () => service.delete(id, context),
      () => service.publish(id, context),
      () => service.archive(id, context),
      () => service.updateContent(id, { content: 'Denied', format: 'markdown' }, context),
      () => service.createFromTicket(id, context),
      () => service.bulkCreate([{}], context),
      () => service.bulkUpdate([{ id, data: { slug: 'denied' } }], context),
      () => service.bulkDelete([id], context),
    ];
    for (const mutate of mutations) await expect(mutate()).rejects.toMatchObject({ code: 'CO_MANAGED_NOT_ACTIVE' });
    await acceptCoManagedRelationship(db, actor, input);
    const article = await service.create(data, context); id = article.article_id;
    await expireCoManagedEntitlement(operation.tenant);
    for (const mutate of mutations) await expect(mutate()).rejects.toMatchObject({ code: 'CO_MANAGED_READ_ONLY' });
    expect(await service.getById(id, context)).toMatchObject({ document_name: 'Customer guide', status: 'draft' });
    expect(await service.getContent(id, context)).toMatchObject({ content: '# Guide' });
    expect(await service.list({}, context)).toMatchObject({ data: [expect.objectContaining({ article_id: id })], total: 1 });
  });

  it('rolls back failed article/document changes, preserves caller transactions, and synchronizes publication visibility after renewal', async () => {
    const { operation, actor, input, customer } = await readyForAcceptance();
    await acceptCoManagedRelationship(db, actor, input);
    const { KbArticleService } = await import('../../lib/api/services/KbArticleService');
    const { withTransaction } = await import('@alga-psa/db');
    const service = new KbArticleService();
    vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: db });
    const context = { tenant: actor.tenant, userId: actor.userId };
    const data = { title: 'Customer guide', article_type: 'how_to' as const, audience: 'client' as const, content: '# Guide', content_format: 'markdown' as const };
    await expect(service.create({ ...data, content: '{invalid', content_format: 'blocknote' }, context)).rejects.toThrow('Invalid BlockNote content');
    await expect(service.create({ ...data, category_id: 'invalid-uuid' }, context)).rejects.toMatchObject({ code: '22P02' });
    for (const table of ['kb_articles', 'documents', 'document_block_content']) expect(await customer.table(table)).toEqual([]);
    await expect(withTransaction(db, async trx => {
      const article = await service.create(data, { ...context, db: trx });
      expect(article).toMatchObject({ document_name: data.title });
      throw new Error('Caller cancelled article');
    })).rejects.toThrow('Caller cancelled article');
    for (const table of ['kb_articles', 'documents', 'document_block_content']) expect(await customer.table(table)).toEqual([]);
    const article = await service.create(data, context);
    const other = await service.create({ ...data, title: 'Other guide' }, context);
    await expect(service.update(article.article_id, { title: 'Must roll back', slug: other.slug }, context)).rejects.toThrow('already exists');
    expect(await service.getById(article.article_id, context)).toMatchObject({ document_name: data.title });
    await expireCoManagedEntitlement(operation.tenant);
    const entitlement = await tenantDb(db, operation.tenant).table('co_managed_entitlements').first();
    await reconcileHostedCoManagedEntitlement(db, operation.tenant, entitlement.source_reference,
      async () => ({ active: true, capacity: 2, validUntil: new Date(Date.now() + 3600000) }));
    const document = () => customer.table('documents').where('document_id', article.document_id).first();
    expect((await document()).is_client_visible).toBe(false);
    expect(await service.publish(article.article_id, context)).toMatchObject({ status: 'published' });
    expect((await document()).is_client_visible).toBe(true);
    await service.update(article.article_id, { audience: 'internal' }, context);
    expect((await document()).is_client_visible).toBe(false);
    await service.publish(article.article_id, context);
    expect((await document()).is_client_visible).toBe(false);
    await service.update(article.article_id, { audience: 'client' }, context);
    expect((await document()).is_client_visible).toBe(true);
    await service.archive(article.article_id, context);
    expect((await document()).is_client_visible).toBe(false);
    await service.updateContent(article.article_id, { content: '# Renewed', format: 'markdown' }, context);
    expect(await service.getContent(article.article_id, context)).toMatchObject({ content: '# Renewed' });
    const ticketStatus = await customer.table('statuses').where({ board_id: operation.customer_board_id, item_type: 'ticket' }).first();
    const priority = await customer.table('priorities').where('item_type', 'ticket').first();
    const ticketId = randomUUID();
    await customer.table('tickets').insert({ tenant: actor.tenant, ticket_id: ticketId, ticket_number: 'KB-1', title: 'Learned from ticket',
      client_id: operation.customer_client_id, board_id: operation.customer_board_id, status_id: ticketStatus.status_id,
      priority_id: priority.priority_id, entered_by: actor.userId, attributes: { description: 'Problem description' } });
    const fromTicket = await service.createFromTicket(ticketId, context);
    expect(fromTicket).toMatchObject({ document_name: 'Learned from ticket', audience: 'internal' });
    expect(await service.getContent(fromTicket.article_id, context)).toMatchObject({ content: expect.stringContaining('Problem description') });
    for (const id of [article.article_id, other.article_id, fromTicket.article_id]) await service.delete(id, context);
    for (const table of ['kb_articles', 'documents', 'document_block_content']) expect(await customer.table(table)).toEqual([]);
  });
});
