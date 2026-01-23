import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@alga-psa/core', () => ({
  getSecret: vi.fn(async (_key: string, envVar?: string) => {
    if (!envVar) return null;
    return process.env[envVar] ?? null;
  }),
}));

describe('knexfile', () => {
  beforeEach(() => {
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

