import { describe, expect, it } from 'vitest';
import { applicationTestDatabaseConfig } from '../../e2e/utils/applicationTestDatabase';

const isolated = {
  E2E_DATABASE_ISOLATED: 'true', E2E_DB_HOST: '127.0.0.1', E2E_DB_PORT: '55432',
  E2E_DB_NAME: 'owned_api_test', E2E_DB_USER: 'fixture_user', E2E_DB_PASSWORD: 'synthetic',
};

describe('API E2E application database configuration', () => {
  it('uses only the explicitly selected application database without ambient DB fallbacks', () => {
    expect(applicationTestDatabaseConfig({ ...isolated, DB_NAME_SERVER: 'production', TEST_DB_NAME: 'unrelated_test' }))
      .toMatchObject({ client: 'pg', connection: { host: '127.0.0.1', port: 55432,
        database: 'owned_api_test', user: 'fixture_user', password: 'synthetic' } });
  });

  it('refuses ambiguous ownership, incomplete connection settings and unsafe database identities', () => {
    for (const key of Object.keys(isolated)) {
      expect(() => applicationTestDatabaseConfig({ ...isolated, [key]: '' })).toThrow();
    }
    for (const name of ['server', 'production', 'PROD', '../owned_api_test']) {
      expect(() => applicationTestDatabaseConfig({ ...isolated, E2E_DB_NAME: name })).toThrow();
    }
    for (const port of ['0', '65536', '5432garbage', '3.5']) {
      expect(() => applicationTestDatabaseConfig({ ...isolated, E2E_DB_PORT: port })).toThrow();
    }
  });
});
