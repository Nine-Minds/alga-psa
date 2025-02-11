import { Knex } from 'knex';
import { setTypeParser } from 'pg-types';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

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

import { getSecret } from '../utils/getSecret';

const getDbPassword = async () => getSecret('db_password_server', 'DB_PASSWORD_SERVER');
const getPostgresPassword = async () => getSecret('postgres_password', 'DB_PASSWORD_ADMIN');

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
      password: process.env.DB_PASSWORD_SERVER || '', // Fallback for tools that need sync config
      database: process.env.DB_NAME_SERVER || 'server'
    },
    pool: {
      min: 0,
      max: 20,
      idleTimeoutMillis: 1000,
      reapIntervalMillis: 1000,
      createTimeoutMillis: 30000,
      destroyTimeoutMillis: 5000
    }
  },
  production: {
    client: 'pg',
    connection: {
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT) || 5432,
      user: 'app_user',
      password: process.env.DB_PASSWORD_SERVER || '', // Fallback for tools that need sync config
      database: process.env.DB_NAME_SERVER || 'server'
    },
    pool: {
      min: 0,
      max: 20,
      idleTimeoutMillis: 1000,
      reapIntervalMillis: 1000,
      createTimeoutMillis: 30000,
      destroyTimeoutMillis: 5000
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
  return getFullConfig(env);
}

export const getKnexConfigWithTenant = async (tenant: string): Promise<CustomKnexConfig> => {
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
      conn.query(`SET app.current_tenant = '${tenant}'`, (err: Error) => {
        done(err, conn);
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
