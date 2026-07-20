import fs from 'node:fs';
import process from 'node:process';

import type { Knex } from 'knex';

export interface DatabaseConfigOverrides {
  connectionString?: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  poolMax?: number;
}

function readPasswordFromEnvironment(): string {
  if (process.env.AI_GATEWAY_DB_PASSWORD !== undefined) {
    return process.env.AI_GATEWAY_DB_PASSWORD;
  }

  const passwordFile = process.env.AI_GATEWAY_DB_PASSWORD_FILE;
  if (passwordFile && fs.existsSync(passwordFile)) {
    return fs.readFileSync(passwordFile, 'utf8').trim();
  }

  return '';
}

export function createKnexConfig(overrides: DatabaseConfigOverrides = {}): Knex.Config {
  const connectionString =
    overrides.connectionString?.trim() || process.env.AI_GATEWAY_DATABASE_URL?.trim();
  const connection =
    connectionString ||
    ({
      host: overrides.host ?? process.env.AI_GATEWAY_DB_HOST ?? '127.0.0.1',
      port: overrides.port ?? Number.parseInt(process.env.AI_GATEWAY_DB_PORT ?? '5432', 10),
      database: overrides.database ?? process.env.AI_GATEWAY_DB_NAME ?? 'ai_gateway',
      user: overrides.user ?? process.env.AI_GATEWAY_DB_USER ?? 'postgres',
      password: overrides.password ?? readPasswordFromEnvironment(),
    } satisfies Knex.PgConnectionConfig);

  return {
    client: 'pg',
    connection,
    pool: {
      min: 0,
      max: overrides.poolMax ?? 10,
    },
  };
}
