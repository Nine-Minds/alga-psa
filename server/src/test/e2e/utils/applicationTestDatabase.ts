import { knex, type Knex } from 'knex';

export function applicationTestDatabaseConfig(env: Record<string, string | undefined> = process.env): Knex.Config {
  if (env.E2E_DATABASE_ISOLATED !== 'true') {
    throw new Error('API E2E tests require E2E_DATABASE_ISOLATED=true and an owned application database');
  }
  for (const name of ['E2E_DB_HOST', 'E2E_DB_PORT', 'E2E_DB_NAME', 'E2E_DB_USER', 'E2E_DB_PASSWORD']) {
    if (!env[name]?.trim()) throw new Error(`API E2E tests require explicit ${name}`);
  }
  const port = Number(env.E2E_DB_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid E2E_DB_PORT');
  if (!/^[a-z0-9_]+$/i.test(env.E2E_DB_NAME!) || /^(server|prod|production|sebastian_prod)$/i.test(env.E2E_DB_NAME!)) {
    throw new Error('API E2E tests require a dedicated test database name');
  }
  return { client: 'pg', connection: {
    host: env.E2E_DB_HOST, port, database: env.E2E_DB_NAME,
    user: env.E2E_DB_USER, password: env.E2E_DB_PASSWORD,
  }, pool: { min: 0, max: 5 } };
}

// Connect only: schema creation and migration belong to the application stack.
export function connectApplicationTestDatabase(): Knex {
  return knex(applicationTestDatabaseConfig());
}
