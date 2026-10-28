import { afterAll, beforeAll, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { prepareCoManagedProvisioning } from '../../../../../packages/co-managed/src/provisioning';
import { createTestDbConnection, wireLocalTestDbEnv } from '../../../../../server/test-utils/dbConfig';
import { registerCoManagedProvisioningTests } from './helpers/coManagedProvisioningCases';
import { registerCoManagedProvisioningCleanupTests } from './helpers/coManagedProvisioningCleanupCases';

// Activities run synchronously against a disposable database migrated from this
// branch's migration set. Every worker connection resolves to it.
const delivery = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('@temporalio/activity', async importOriginal => ({
  ...(await importOriginal<typeof import('@temporalio/activity')>()),
  Context: { current: () => ({ log: { info() {}, warn() {}, error() {} } }) },
}));
vi.mock('@alga-psa/email', () => ({ sendTeamInvitationEmail: delivery.send }));
vi.mock('@alga-psa/db/admin.js', () => ({
  getAdminConnection: async () => db,
  withAdminTransactionRetryReadOnly: (work: (trx: Knex.Transaction) => Promise<unknown>) => db.transaction(work),
}));

let db: Knex;
const databaseName = `co_managed_provisioning_${randomUUID().replaceAll('-', '')}`.slice(0, 60);

beforeAll(async () => {
  wireLocalTestDbEnv();
  db = await createTestDbConnection({ databaseName });
}, 600000);

afterAll(async () => {
  await db?.destroy();
  const { default: knex } = await import('knex');
  const admin = knex({ client: 'pg', connection: { host: process.env.DB_HOST, port: Number(process.env.DB_PORT),
    user: process.env.DB_USER_ADMIN, password: process.env.DB_PASSWORD_ADMIN, database: 'postgres' } });
  try {
    await admin.raw('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ? AND pid <> pg_backend_pid()', [databaseName]);
    await admin.raw('DROP DATABASE IF EXISTS ??', [databaseName]);
  } finally { await admin.destroy(); }
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

registerCoManagedProvisioningTests({ getDb: () => db, prepare, delivery });
registerCoManagedProvisioningCleanupTests(() => db, prepare);
