import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { prepareCoManagedProvisioning } from '../../../../../../packages/co-managed/src/provisioning';

// Shared L1a fixture: importable without the native-access suite's module mocks.
/** A sponsoring MSP with a Pro entitlement, one client, one internal user holding the
 * co-management permissions through a real session, and a reserved operation. */
export async function prepareNativeAccessOperation(db: Knex, overrides: { seats?: number; email?: string; capacity?: number } = {}) {
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
