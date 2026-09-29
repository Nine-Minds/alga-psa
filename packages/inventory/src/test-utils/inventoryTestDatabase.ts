import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';

/** Inventory suites run only against the workspace runner's disposable database. */
export function getInventoryTestDatabaseConnection(): Knex.PgConnectionConfig {
  const database = process.env.TEST_DB_NAME;
  const user = process.env.DB_USER_ADMIN;
  const password = process.env.DB_PASSWORD_ADMIN;
  if (process.env.REQUIRE_DB !== '1' || !database || !user || !password) {
    throw new Error('Inventory DB tests require REQUIRE_DB=1, TEST_DB_NAME, DB_USER_ADMIN and DB_PASSWORD_ADMIN; use scripts/run-workspace-db-tests.mjs');
  }
  if (!/(^|_)(test|tests|regression)(_|$)/i.test(database)) {
    throw new Error(`Inventory fixtures require a disposable test database: ${database}`);
  }
  return {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 5432),
    user, password, database,
  };
}

/**
 * Commit a fresh tenant per suite so separate transactions can exercise locking.
 * The workspace runner recreates the database; individual cases roll back their
 * mutations or clean up their committed concurrency fixtures.
 */
export async function createInventoryTestTenant(db: Knex): Promise<string> {
  const tenant = randomUUID();
  const userId = randomUUID();
  const clientId = randomUUID();
  const serviceTypeId = randomUUID();
  const boardId = randomUUID();
  const statusId = randomUUID();
  const priorityId = randomUUID();
  await db.transaction(async (trx) => {
    await trx('tenants').insert({ tenant, client_name: `Inventory regression ${tenant}`, email: `inventory-${tenant}@example.invalid`, product_code: 'psa' });
    await trx('users').insert({ tenant, user_id: userId, username: `inventory-${tenant}`, email: `operator-${tenant}@example.invalid`, hashed_password: 'not-a-login-credential', user_type: 'internal', first_name: 'Inventory', last_name: 'Operator' });
    await trx('clients').insert({ tenant, client_id: clientId, client_name: 'Inventory customer', billing_cycle: 'monthly', billing_email: `billing-${tenant}@example.invalid` });
    await trx('service_types').insert({ tenant, id: serviceTypeId, name: 'Inventory fixture services', is_active: true, order_number: 1 });
    await trx('service_catalog').insert([1, 2, 3].map(index => ({ tenant, service_id: randomUUID(), service_name: `Inventory fixture ${index}`, item_kind: 'service', billing_method: 'fixed', custom_service_type_id: serviceTypeId, default_rate: 5000, unit_of_measure: 'unit', is_active: true })));
    await trx('stock_locations').insert({ tenant, location_id: randomUUID(), name: 'Test warehouse', location_type: 'warehouse', is_default: true, is_active: true, manager_user_id: userId });
    await trx('vendors').insert({ tenant, vendor_id: randomUUID(), vendor_name: 'Test supplier' });
    await trx('boards').insert({ tenant, board_id: boardId, board_name: 'Inventory requests', is_default: true });
    await trx('statuses').insert({ tenant, board_id: boardId, status_id: statusId, name: 'Open', status_type: 'ticket', order_number: 1, is_closed: false });
    await trx('priorities').insert({ tenant, priority_id: priorityId, priority_name: 'Normal', created_by: userId, order_number: 1 });
    await trx('tickets').insert({ tenant, ticket_id: randomUUID(), ticket_number: `INV-${tenant}`, title: 'Inventory material request', client_id: clientId, board_id: boardId, status_id: statusId, priority_id: priorityId, entered_by: userId });
  });
  return tenant;
}
