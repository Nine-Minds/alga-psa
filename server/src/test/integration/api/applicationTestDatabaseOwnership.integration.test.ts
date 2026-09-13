import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import { connectApplicationTestDatabase } from '../../e2e/utils/applicationTestDatabase';

describe('API E2E database ownership attestation', () => {
  let owner: Knex;
  let env: Record<string, string>;

  beforeAll(async () => {
    owner = await createTestDbConnection();
    const connection = owner.client.config.connection as Knex.PgConnectionConfig;
    env = {
      E2E_DATABASE_ISOLATED: 'true',
      E2E_DB_HOST: connection.host!, E2E_DB_PORT: String(connection.port),
      E2E_DB_NAME: connection.database!, E2E_DB_USER: connection.user!,
      E2E_DB_PASSWORD: connection.password as string, E2E_DATABASE_ID: randomUUID(),
    };
  }, 120_000);

  afterAll(async () => { await owner?.destroy(); });

  it('rejects absent, stale and wrong-database markers before allowing fixture writes', async () => {
    await expect(connectApplicationTestDatabase(env)).rejects.toThrow('ownership verification failed');
    // A failed verification must not provision its own proof of ownership.
    expect(await owner.schema.hasTable('alga_test_environment_ownership')).toBe(false);
    await owner.raw(`CREATE TABLE public.alga_test_environment_ownership (
      singleton boolean PRIMARY KEY CHECK (singleton),
      environment_id uuid NOT NULL,
      database_name text NOT NULL
    )`);
    await expect(connectApplicationTestDatabase(env)).rejects.toThrow('ownership verification failed');
    await owner('alga_test_environment_ownership').insert({
      singleton: true, environment_id: randomUUID(), database_name: env.E2E_DB_NAME,
    });
    await expect(connectApplicationTestDatabase(env)).rejects.toThrow('ownership verification failed');
    await owner('alga_test_environment_ownership').update({
      environment_id: env.E2E_DATABASE_ID, database_name: 'another_environment',
    });
    await expect(connectApplicationTestDatabase(env)).rejects.toThrow('ownership verification failed');
    await owner('alga_test_environment_ownership').update({ database_name: env.E2E_DB_NAME });

    const verified = await connectApplicationTestDatabase(env);
    try {
      // Exercise real writes through the returned handle, without touching app data.
      await verified.raw('CREATE TEMP TABLE ownership_fixture (value text)');
      await verified('ownership_fixture').insert({ value: 'verified fixture' });
      expect(await verified('ownership_fixture').select('value')).toEqual([{ value: 'verified fixture' }]);
    } finally {
      await verified.destroy();
    }
    expect(await owner('alga_test_environment_ownership').first()).toMatchObject({
      environment_id: env.E2E_DATABASE_ID, database_name: env.E2E_DB_NAME,
    });
  });
});
