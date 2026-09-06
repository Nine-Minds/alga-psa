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

const delivery = vi.hoisted(() => ({ send: vi.fn() }));
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
vi.mock('@alga-psa/email', () => ({ sendTeamInvitationEmail: delivery.send }));
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
