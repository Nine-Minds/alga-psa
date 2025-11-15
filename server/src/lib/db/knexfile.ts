import { Knex } from 'knex';
import { setTypeParser } from 'pg-types';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import process
 from 'process';
 import { validate as uuidValidate } from 'uuid';

type Function = (err: Error | null, connection: Knex.Client) => void;

// Load test environment variables if we're in a test environment
if (process.env.NODE_ENV === 'test') {
  const result = dotenv.config({
    path: '.env.localtest'
  });
  if (result.parsed?.DB_NAME_SERVER) {
    process.env.DB_NAME_SERVER = result.parsed.DB_NAME_SERVER;
  }
}

setTypeParser(20, parseFloat);
setTypeParser(1114, str => new Date(str + 'Z')); // TIMESTAMP WITHOUT TIME ZONE - add Z to parse as UTC
setTypeParser(1184, str => new Date(str)); // TIMESTAMP WITH TIME ZONE - already has timezone info, parse as-is

import { getSecret } from '../utils/getSecret';

const getDbPassword = async () => await getSecret('db_password_server', 'DB_PASSWORD_SERVER');
const getPostgresPassword = async () => await getSecret('postgres_password', 'DB_PASSWORD_ADMIN');

// Special connection config for postgres user (needed for job scheduler)
export const getPostgresConnection = async () => ({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 5432,
  user: process.env.DB_USER_ADMIN || 'postgres',
  password: await getPostgresPassword(),
  database: process.env.DB_NAME_SERVER || 'server'
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
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT) || 5432,
      user: process.env.DB_USER_SERVER || 'app_user',
      password: getDbPassword,
      database: process.env.DB_NAME_SERVER || 'server'
    },
    pool: {
      min: 0,
      max: 80,
      idleTimeoutMillis: 1000,
      reapIntervalMillis: 1000,
      createTimeoutMillis: 30000,
      destroyTimeoutMillis: 5000
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
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT) || 5432,
      user: 'app_user',
      password: getDbPassword,
      database: process.env.DB_NAME_SERVER || 'server'
    },
    pool: {
      min: 0,
      max: 30,
      idleTimeoutMillis: 500,
      reapIntervalMillis: 300,
      createTimeoutMillis: 3000,
      destroyTimeoutMillis: 300
    },
    afterCreate: (conn: any, done: Function) => {
      conn.query('SET TIME ZONE \'UTC\'', (err: Error) => {
        done(err, conn);
      });
    }
  }
};

// Async function to get full config with passwords
export function getFullConfig(env: string): CustomKnexConfig {
  const configForEnv = baseConfig[env];
  if (!configForEnv) {
    throw new Error(`Configuration for environment "${env}" not found.`);
  }
  return configForEnv;
}

// Main config getter function
export async function getKnexConfig(env: string): Promise<CustomKnexConfig> {
  const config = getFullConfig(env);
  console.log(`Getting knex config for environment: ${env}`);
  console.log(`Connection pool config: min=${config.pool?.min}, max=${config.pool?.max}`);
  return config;
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

  const env = process.env.APP_ENV || 'development';
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
      console.log(`Creating new connection for tenant: ${tenant}`);
      conn.on('error', (err: Error) => {
        const msg = String((err && (err as any).message) || err || '');
        console.error('Database connection error:', err);
        if (/SCRAM|wrong password type|SASL|password authentication failed/i.test(msg)) {
          console.error('=== DB Troubleshooter Hint ===');
          console.error('Possible PgBouncer/Postgres auth mismatch or secret drift.');
          console.error('If using PgBouncer, ensure Postgres stores md5 hashes for roles used via PgBouncer.');
          console.error('Quick fix (run in Postgres container):');
          console.error("  psql -U postgres -d postgres -c \"SET password_encryption = 'md5'; ALTER ROLE postgres WITH PASSWORD '<admin secret>';\"");
          console.error('Also verify app_user password matches secret db_password_server.');
          console.error('See docs/setup_guide.md (Troubleshooting → Postgres authentication loop).');
        }
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
        console.log(`Connection created for tenant: ${tenant} (CitusDB handles isolation automatically, timezone set to UTC)`);
        done(null, conn);
      });
    },
    afterRelease: (conn: any, done: Function) => {
      console.log('Releasing connection back to the pool');
      conn.query('SELECT 1', (err: Error) => {
        if (err) {
          console.error(`Error checking connection health: ${err.message}`);
          done(err, conn);
        } else {
          console.log('Connection health check passed');
          done(null, conn);
        }
      });
    }
  };
};

// Export base config for tools that require synchronous config
export default baseConfig;
