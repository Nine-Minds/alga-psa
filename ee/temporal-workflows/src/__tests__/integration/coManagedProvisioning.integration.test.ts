import { afterAll, beforeAll, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { prepareUpgradeSchema } from '../../../../../scripts/lib/upgrade-schema-source.mjs';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { prepareCoManagedProvisioning } from '../../../../../packages/co-managed/src/provisioning';
import { createTestDbConnection, wireLocalTestDbEnv } from '../../../../../server/test-utils/dbConfig';
import { registerCoManagedProvisioningTests } from './helpers/coManagedProvisioningCases';
import { registerCoManagedProvisioningCleanupTests } from './helpers/coManagedProvisioningCleanupCases';

// Activities run synchronously against a disposable database migrated from this
// branch's migration set. Every worker connection resolves to it.
const delivery = vi.hoisted(() => ({ send: vi.fn() }));
const actorState = vi.hoisted(() => ({ user: null as any }));
const appliance = vi.hoisted(() => ({ check: vi.fn(async () => ({ seats: 0 })) }));
vi.mock('@alga-psa/db', async importOriginal => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return { ...actual, getAdminConnection: async () => db,
    getConnection: async () => db,
    createTenantKnex: async (tenant?: string) => ({ knex: db, tenant: tenant ?? actual.getTenantContext() }) };
});
vi.mock('@alga-psa/auth', async () => ({
  withAuth: (handler: any) => (...args: any[]) => handler(actorState.user, { tenant: actorState.user.tenant }, ...args),
  hasPermission: async (...args: Parameters<typeof import('../../../../../packages/auth/src/lib/rbac').hasPermission>) =>
    (await import('../../../../../packages/auth/src/lib/rbac')).hasPermission(...args),
  checkMultiplePermissions: async (...args: Parameters<typeof import('../../../../../packages/auth/src/lib/rbac').checkMultiplePermissions>) =>
    (await import('../../../../../packages/auth/src/lib/rbac')).checkMultiplePermissions(...args),
  shouldTouchApiKeyLastUsed: (await import('../../../../../packages/auth/src/services/apiKeyService')).shouldTouchApiKeyLastUsed,
  checkPortalInvitationLimit: async () => ({ success: true }), formatRateLimitError: async () => 'Rate limited',
  verifyAuthenticator: async () => false,
}));
vi.mock('@alga-psa/user-composition/actions', () => ({ getCurrentUser: async () => actorState.user }));
vi.mock('@alga-psa/user-composition/lib/permissions', () => ({ hasPermission: async () => true }));
vi.mock('@enterprise/lib/license/userSeatGuard', () => ({ checkApplianceLicenseSeatLimit: appliance.check }));
vi.mock('@temporalio/activity', async importOriginal => ({
  ...(await importOriginal<typeof import('@temporalio/activity')>()),
  Context: { current: () => ({ log: { info() {}, warn() {}, error() {} } }) },
}));
vi.mock('@alga-psa/email', () => ({ sendTeamInvitationEmail: delivery.send,
  TenantEmailService: { getInstance: () => ({ isConfigured: async () => true }) }, getSystemEmailService: async () => ({ isConfigured: async () => true }) }));
vi.mock('@alga-psa/db/admin.js', () => ({
  getAdminConnection: async () => db,
  withAdminTransactionRetryReadOnly: (work: (trx: Knex.Transaction) => Promise<unknown>) => db.transaction(work),
}));

let db: Knex;
let migrationWork: string;
const databaseName = `co_managed_provisioning_${randomUUID().replaceAll('-', '')}`.slice(0, 60);

beforeAll(async () => {
  wireLocalTestDbEnv();
  process.env.NEXTAUTH_SECRET = 'co-managed-integration-test-secret';
  const root = path.resolve(__dirname, '../../../../..');
  migrationWork = mkdtempSync(path.join(tmpdir(), 'co-managed-schema-'));
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const schema = prepareUpgradeSchema({ repository: root, commit, destination: path.join(migrationWork, 'schema'), edition: 'ee' });
  symlinkSync(path.join(root, 'node_modules'), path.join(migrationWork, 'schema', 'node_modules'));
  db = await createTestDbConnection({ databaseName, migrationsDir: schema.directory });
}, 600000);

afterAll(async () => {
  await db?.destroy();
  const { default: knex } = await import('knex');
  const admin = knex({ client: 'pg', connection: { host: process.env.DB_HOST, port: Number(process.env.DB_PORT),
    user: process.env.DB_USER_ADMIN, password: process.env.DB_PASSWORD_ADMIN, database: 'postgres' } });
  try {
    await admin.raw('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ? AND pid <> pg_backend_pid()', [databaseName]);
    await admin.raw('DROP DATABASE IF EXISTS ??', [databaseName]);
  } finally { await admin.destroy(); if (migrationWork) rmSync(migrationWork, { recursive: true, force: true }); }
});

/** A sponsoring MSP with a Pro entitlement, one client, one internal user holding the
 * co-management permissions through a real session, and a reserved operation. */
async function prepare(overrides: { seats?: number; email?: string; capacity?: number } = {}) {
  const sponsorTenant = randomUUID(), clientId = randomUUID(), requestedBy = randomUUID(), escalationBoardId = randomUUID();
  const sponsor = tenantDb(db, sponsorTenant);
  await sponsor.table('tenants').insert({ tenant: sponsorTenant, client_name: 'MSP', email: `msp-${sponsorTenant}@example.test`,
    plan: 'pro', product_code: 'psa' });
  await sponsor.table('clients').insert({ tenant: sponsorTenant, client_id: clientId, client_name: 'Customer' });
  await sponsor.table('users').insert({ tenant: sponsorTenant, user_id: requestedBy, username: `msp-${requestedBy}`,
    email: `msp-${requestedBy}@example.test`, first_name: 'MSP', last_name: 'Admin', hashed_password: 'test-not-a-login',
    user_type: 'internal', is_inactive: false });
  await sponsor.table('boards').insert({ tenant: sponsorTenant, board_id: escalationBoardId, board_name: 'Escalations', is_inactive: false });
  await sponsor.table('co_managed_entitlements').insert({ tenant: sponsorTenant, source: 'hosted', source_reference: randomUUID(),
    capacity: overrides.capacity ?? 4, verified_at: new Date(), valid_until: new Date(Date.now() + 3600000) });
  const operation = await prepareCoManagedProvisioning(db, { sponsorTenant, clientId, requestedBy, escalationBoardId,
    operationId: randomUUID(), seats: overrides.seats ?? 2, visibilityMode: 'board_scope', workspaceName: 'Customer IT',
    administrator: { firstName: 'Customer', lastName: 'Admin', email: overrides.email ?? `admin-${randomUUID()}@example.test` } });
  return operation;
}

registerCoManagedProvisioningTests({ getDb: () => db, prepare, delivery, actorState, appliance });
registerCoManagedProvisioningCleanupTests(() => db, prepare);
