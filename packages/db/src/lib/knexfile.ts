/**
 * @alga-psa/db - Knex Configuration
 *
 * Database configuration for Knex query builder.
 * Supports development, test, and production environments.
 */

import { Knex } from 'knex';
import { setTypeParser } from 'pg-types';
import { validate as uuidValidate } from 'uuid';
import { getSecret } from '@alga-psa/core';

type Function = (err: Error | null, connection: Knex.Client) => void;

// Load test environment variables if we're in a test environment
if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'test') {
  try {
    const dotenv = await import('dotenv');
    const result = dotenv.config({ path: '.env.localtest' });
    if (result.parsed?.DB_NAME_SERVER) {
      (process.env as any).DB_NAME_SERVER = result.parsed.DB_NAME_SERVER;
    }
  } catch {}
}

setTypeParser(20, parseFloat);
setTypeParser(1114, (str: string) => new Date(str + 'Z')); // TIMESTAMP WITHOUT TIME ZONE - add Z to parse as UTC
setTypeParser(1184, (str: string) => new Date(str)); // TIMESTAMP WITH TIME ZONE - already has timezone info, parse as-is

const getDbPassword = async () => await getSecret('db_password_server', 'DB_PASSWORD_SERVER');
const getPostgresPassword = async () => await getSecret('postgres_password', 'DB_PASSWORD_ADMIN');

// Special connection config for postgres user (needed for job scheduler)
export const getPostgresConnection = async () => ({
  host:
    (typeof process !== 'undefined' &&
      (process.env?.DB_HOST_ADMIN || process.env?.DB_HOST)) ||
    'localhost',
  port: Number(
    (typeof process !== 'undefined' &&
      (process.env?.DB_PORT_ADMIN || process.env?.DB_PORT)) ||
      5432
  ),
  user: (typeof process !== 'undefined' && process.env?.DB_USER_ADMIN) || 'postgres',
  password: await getPostgresPassword(),
  database: (typeof process !== 'undefined' && process.env?.DB_NAME_SERVER) || 'server'
} satisfies Knex.PgConnectionConfig);

interface CustomKnexConfig extends Knex.Config {
  connection: Knex.PgConnectionConfig;
  pool?: {
    min?: number;
    max?: number;
    idleTimeoutMillis?: number;
    reapIntervalMillis?: number;
    createTimeoutMillis?: number;
    destroyTimeoutMillis?: number;
  };
  afterCreate?: (conn: any, done: Function) => void;
  afterRelease?: (conn: any, done: Function) => void;
}

// Base configuration without passwords
const baseConfig: Record<string, CustomKnexConfig> = {
  development: {
    client: 'pg',
    connection: {
      host: (typeof process !== 'undefined' && process.env?.DB_HOST) || 'localhost',
      port: Number((typeof process !== 'undefined' && process.env?.DB_PORT) || 5432),
      user: (typeof process !== 'undefined' && process.env?.DB_USER_SERVER) || 'app_user',
      password: await getDbPassword(),
      database: (typeof process !== 'undefined' && process.env?.DB_NAME_SERVER) || 'server'
    },
    pool: {
      min: 0,
      max: 20,
      idleTimeoutMillis: 500,
      reapIntervalMillis: 500,
      createTimeoutMillis: 1000,
      destroyTimeoutMillis: 500
    },
    afterCreate: (conn: any, done: Function) => {
      conn.query('SET TIME ZONE \'UTC\'', (err: Error) => {
        done(err, conn);
      });
    }
  },
  test: {
    client: 'pg',
    connection: {
      host: (typeof process !== 'undefined' && process.env?.DB_HOST) || 'localhost',
      port: Number((typeof process !== 'undefined' && process.env?.DB_PORT) || 5432),
      user: (typeof process !== 'undefined' && process.env?.DB_USER_ADMIN) || 'postgres',
      password: await getPostgresPassword(),
      database: (typeof process !== 'undefined' && process.env?.DB_NAME_SERVER) || 'server'
    },
    pool: {
      min: 0,
      max: 10,
      idleTimeoutMillis: 1000,
      reapIntervalMillis: 1000,
      createTimeoutMillis: 3000,
      destroyTimeoutMillis: 1000
    },
    afterCreate: (conn: any, done: Function) => {
      conn.query('SET TIME ZONE \'UTC\'', (err: Error) => {
        done(err, conn);
      });
    }
  },
  production: {
    client: 'pg',
    connection: {
      host: (typeof process !== 'undefined' && process.env?.DB_HOST) || 'localhost',
      port: Number((typeof process !== 'undefined' && process.env?.DB_PORT) || 5432),
      user: 'app_user',
      password: await getDbPassword(),
      database: (typeof process !== 'undefined' && process.env?.DB_NAME_SERVER) || 'server'
    },
    pool: {
      min: 0,
      max: 20,
      idleTimeoutMillis: 500,
      reapIntervalMillis: 500,
      createTimeoutMillis: 1000,
      destroyTimeoutMillis: 500
    },
    afterCreate: (conn: any, done: Function) => {
      conn.query('SET TIME ZONE \'UTC\'', (err: Error) => {
        done(err, conn);
      });
    }
  }
};

// Async function to get full config with passwords
export async function getFullConfig(env: string): Promise<CustomKnexConfig> {
  const password = await getDbPassword();
  return {
    ...baseConfig[env],
    connection: {
      ...baseConfig[env].connection,
      password: password || baseConfig[env].connection.password
    }
  };
}

// Main config getter function
export async function getKnexConfig(env: string): Promise<CustomKnexConfig> {
  return await getFullConfig(env);
}

function isValidTenantId(tenantId: string): boolean {
  if (!tenantId) return true;
  if (tenantId === 'default') return true;
  return uuidValidate(tenantId);
}

export const getKnexConfigWithTenant = async (tenant: string): Promise<CustomKnexConfig> => {
  if (!isValidTenantId(tenant)) {
    throw new Error('Invalid tenant ID format');
  }

  const env = (typeof process !== 'undefined' && process.env?.APP_ENV) || 'development';
  const config = await getKnexConfig(env);

  return {
    ...config,
    asyncStackTraces: true,
    wrapIdentifier: (value: string, origImpl: (value: string) => string) => {
      return origImpl(value);
    },
    postProcessResponse: (result: Record<string, unknown>[] | unknown) => {
      return result;
    },
    acquireConnectionTimeout: 60000,
    afterCreate: (conn: any, done: Function) => {
      conn.on('error', (err: Error) => {
        console.error('Database connection error:', err);
      });
      // Set timezone to UTC for all timestamps
      conn.query('SET TIME ZONE \'UTC\'', (err: Error) => {
        if (err) {
          console.error('Error setting timezone to UTC:', err);
          done(err, conn);
          return;
        }
        // With CitusDB, tenant isolation is handled automatically at the shard level
        // No need to set app.current_tenant session variable
        done(null, conn);
      });
    },
    afterRelease: (conn: any, done: Function) => {
      conn.query('SELECT 1', (err: Error) => {
        if (err) {
          done(err, conn);
        } else {
          done(null, conn);
        }
      });
    }
  };
};

// Export base config for tools that require synchronous config
export default baseConfig;

// Export the CustomKnexConfig type for use elsewhere
export type { CustomKnexConfig };
