import knex, { type Knex } from 'knex';

/** Connect to the workspace DB runner's already migrated, disposable schema.
 * Package tests must not depend on the server application for a DB fixture.
 * This helper never creates, drops, or migrates a database.
 */
export function createWorkspaceTestDbConnection(): Knex {
  const baseDatabase = process.env.TEST_DB_NAME;
  // Workflow fixtures can switch DB_NAME_SERVER and DB_USER_SERVER together
  // to a worker-specific schema/role. Keep that pair intact across suites.
  const database = process.env.DB_NAME_SERVER || baseDatabase;
  const password = process.env.DB_PASSWORD_SERVER;
  if (!baseDatabase || !/(^|_)test(_|$)/.test(baseDatabase) || !database || !password
    || (database !== baseDatabase && !database.startsWith(`${baseDatabase}_`))) {
    throw new Error('Workspace DB tests require TEST_DB_NAME and DB_PASSWORD_SERVER from the isolated workspace DB runner');
  }
  return knex({ client: 'pg', connection: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER_SERVER || 'app_user', password, database,
  }, pool: { min: 0, max: 2 } });
}
