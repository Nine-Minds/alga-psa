import { describe, expect, it, vi, beforeEach, afterAll } from 'vitest';

// knexfile imports from '@alga-psa/core/secrets'; mock both specifiers so the
// interception holds under configs that alias the subpath to its own module id
// (the server vitest config) as well as ones that don't (this package's).
vi.mock('@alga-psa/core', () => ({
  getSecret: vi.fn(async (_key: string, envVar?: string) => {
    if (!envVar) return null;
    return process.env[envVar] ?? null;
  }),
}));
vi.mock('@alga-psa/core/secrets', () => ({
  getSecret: vi.fn(async (_key: string, envVar?: string) => {
    if (!envVar) return null;
    return process.env[envVar] ?? null;
  }),
}));

const ENV_KEYS = [
  'DB_HOST', 'DB_PORT', 'DB_USER_SERVER', 'DB_NAME_SERVER', 'DB_PASSWORD_SERVER',
  'DB_HOST_ADMIN', 'DB_PORT_ADMIN', 'DB_USER_ADMIN', 'DB_PASSWORD_ADMIN',
] as const;

describe('knexfile', () => {
  // Restore the real env when this file is done: the whole suite shares one
  // fork, so leaked fake creds (DB_HOST=db-host, DB_USER_ADMIN=postgres)
  // un-skip DB-opt-in suites in later files and send them to a phantom host.
  const savedEnv = ENV_KEYS.map((k) => [k, process.env[k]] as const);
  afterAll(() => {
    for (const [k, v] of savedEnv) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  beforeEach(() => {
    vi.resetModules();
    process.env.DB_HOST = 'db-host';
    process.env.DB_PORT = '5439';
    process.env.DB_USER_SERVER = 'app_user';
    process.env.DB_NAME_SERVER = 'server_db';
    process.env.DB_PASSWORD_SERVER = 'server_pw';

    process.env.DB_HOST_ADMIN = 'admin-host';
    process.env.DB_PORT_ADMIN = '5440';
    process.env.DB_USER_ADMIN = 'postgres';
    process.env.DB_PASSWORD_ADMIN = 'admin_pw';
  });

  it('getKnexConfig returns development config derived from env vars', async () => {
    const { getKnexConfig } = await import('./knexfile');

    const config = await getKnexConfig('development');

    expect(config.client).toBe('pg');
    expect(config.connection.host).toBe('db-host');
    expect(config.connection.port).toBe(5439);
    expect(config.connection.user).toBe('app_user');
    expect(config.connection.database).toBe('server_db');
    expect(config.connection.password).toBe('server_pw');
  });

  it('getKnexConfig honors the configured server user in production', async () => {
    process.env.DB_USER_SERVER = 'app_user_pgbouncer';
    const { getKnexConfig } = await import('./knexfile');

    const config = await getKnexConfig('production');

    expect(config.connection.user).toBe('app_user_pgbouncer');
    expect(config.connection.password).toBe('server_pw');
  });

  it('getKnexConfig reflects env changes made after module import', async () => {
    // Regression: integration suites share one fork and repoint DB_NAME_SERVER
    // in beforeAll, after the module graph is already evaluated. A module-level
    // config literal froze the import-time value and sent tenant connections to
    // the previous suite's database.
    const { getKnexConfig } = await import('./knexfile');

    const before = await getKnexConfig('development');
    expect(before.connection.database).toBe('server_db');

    process.env.DB_NAME_SERVER = 'per_suite_db';
    const after = await getKnexConfig('development');
    expect(after.connection.database).toBe('per_suite_db');
  });

  it('getPostgresConnection uses admin env vars and password', async () => {
    const { getPostgresConnection } = await import('./knexfile');

    const connection = await getPostgresConnection();

    expect(connection.host).toBe('admin-host');
    expect(connection.port).toBe(5440);
    expect(connection.user).toBe('postgres');
    expect(connection.database).toBe('server_db');
    expect(connection.password).toBe('admin_pw');
  });
});
