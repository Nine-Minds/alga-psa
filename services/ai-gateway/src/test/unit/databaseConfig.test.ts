import type { Knex } from 'knex';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createKnexConfig } from '../../db/config.js';

describe('database configuration', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses individual Compose DB fields when the optional database URL is blank', () => {
    vi.stubEnv('AI_GATEWAY_DATABASE_URL', '');
    vi.stubEnv('AI_GATEWAY_DB_HOST', 'ai-gateway-postgres');
    vi.stubEnv('AI_GATEWAY_DB_PORT', '5432');
    vi.stubEnv('AI_GATEWAY_DB_NAME', 'ai_gateway');
    vi.stubEnv('AI_GATEWAY_DB_USER', 'postgres');
    vi.stubEnv('AI_GATEWAY_DB_PASSWORD', 'test-password');

    const config = createKnexConfig();

    expect(config.connection as Knex.PgConnectionConfig).toMatchObject({
      host: 'ai-gateway-postgres',
      port: 5432,
      database: 'ai_gateway',
      user: 'postgres',
      password: 'test-password',
    });
  });
});
