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
setTypeParser(1114, str => new Date(str + 'Z'));

import { getSecret } from '../core/getSecret.js';

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
      password: await getDbPassword(),
      database: process.env.DB_NAME_SERVER || 'server'
    },
    pool: {
      min: 0,
      max: 20,
      idleTimeoutMillis: 500,
      reapIntervalMillis: 500,
      createTimeoutMillis: 1000,
      destroyTimeoutMillis: 500
    }
  },
  production: {
    client: 'pg',
    connection: {
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT) || 5432,
      user: 'app_user',
      password: await getDbPassword(),
      database: process.env.DB_NAME_SERVER || 'server'
    },
    pool: {
      min: 0,
      max: 20,
      idleTimeoutMillis: 500,
      reapIntervalMillis: 500,
      createTimeoutMillis: 1000,
      destroyTimeoutMillis: 500
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
      conn.on('error', (err: Error) => {
        console.error('Database connection error:', err);
      });
      // With CitusDB, tenant isolation is handled automatically at the shard level
      // No need to set app.current_tenant session variable
      done(null, conn);
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
