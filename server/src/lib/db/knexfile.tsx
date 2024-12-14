import { TKnexfile } from '@/types';
import { Knex } from 'knex';
import { setTypeParser } from 'pg-types';
import dotenv from 'dotenv';
import fs from 'fs';

type Function = (err: Error | null, connection: Knex.Client) => void;

// Load test environment variables if we're in a test environment
if (process.env.NODE_ENV === 'test') {
  const result = dotenv.config({
    path: '.env.localtest'
  });
  console.log(result);
  if (result.parsed?.DB_NAME_SERVER) {
    process.env.DB_NAME_SERVER = result.parsed.DB_NAME_SERVER;
  }
}

setTypeParser(20, parseFloat);
setTypeParser(1114, str => new Date(str + 'Z'));

const getPassword = (secretPath: string, envVar: string): string => {
  try {
    return fs.readFileSync(secretPath, 'utf8').trim();
  } catch (error) {
    if (process.env[envVar]) {
      console.warn(`Using ${envVar} environment variable instead of Docker secret`);
      return process.env[envVar];
    }
    console.warn(`Neither secret file ${secretPath} nor ${envVar} environment variable found, using empty string`);
    return '';
  }
};

const getDbPassword = () => getPassword('/run/secrets/db_password_server', 'DB_PASSWORD_SERVER');
const getPostgresPassword = () => getPassword('/run/secrets/postgres_password', 'POSTGRES_PASSWORD');

// Special connection config for postgres user (needed for job scheduler)
export const postgresConnection = {
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: 'postgres',
  password: getPostgresPassword(),
  database: process.env.DB_NAME_SERVER
};

const knexfile: TKnexfile = {
  development: {
    client: 'pg',
    connection: {
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT),
      user: process.env.DB_USER_SERVER,
      password: getDbPassword(),
      database: process.env.DB_NAME_SERVER
    },
    pool: {
      min: 0,
      max: 20,
      idleTimeoutMillis: 1000,
      reapIntervalMillis: 1000,
      createTimeoutMillis: 30000,
      // acquireConnectionTimeout: 60000,
      destroyTimeoutMillis: 5000
    }, 
  },
  production: {
    client: 'pg',
    connection: {
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT),
      user: process.env.DB_USER_SERVER,
      password: getDbPassword(),
      database: process.env.DB_NAME_SERVER
    },
    pool: {
      min: 0,
      max: 20,
      idleTimeoutMillis: 1000,
      reapIntervalMillis: 1000,
      createTimeoutMillis: 30000,
      // acquireConnectionTimeout: 60000,
      destroyTimeoutMillis: 5000
    },  
  },
  local: {
    client: 'postgresql',
    connection: {
      host: 'localhost',
      port: 5432,
      user: 'postgres',
      password: getPassword('/run/secrets/postgres_password', 'POSTGRES_PASSWORD'),
      database: 'postgres'
    },
    pool: {
      min: 0,
      max: 20,
      idleTimeoutMillis: 1000,
      reapIntervalMillis: 1000,
      createTimeoutMillis: 30000,
      // acquireConnectionTimeout: 60000,
      destroyTimeoutMillis: 5000
    }
  }
};

export const getKnexConfigWithTenant = (tenant: string) => {
  const env = process.env.APP_ENV || 'development';
  const config = knexfile[env] as Knex.Config;
  config.asyncStackTraces = true;
  
  return {
    ...config,
    wrapIdentifier: (value: string, origImpl: (value: string) => string) => {
      return origImpl(value);
    },
    postProcessResponse: (result: Record<string, unknown>[] | unknown) => {
      // Add any post-processing logic if necessary
      return result;
    },
    acquireConnectionTimeout: 60000,
    afterCreate: (conn: Knex.Client, done: Function) => {
      conn.on('error', (err: Error) => {
        console.error('Database connection error:', err);
      });
      conn.query(`SET app.current_tenant = '${tenant}'`, (err: Error) => {
        done(err, conn);
      });
    },
    afterRelease: (conn: Knex.Client, done: Function) => {
      conn.query('SELECT 1', (err: Error) => {
        if (err) {
          done(err, conn);
        } else {
          done(null, conn);
        }
      });
    }
  } as Knex.Config;
};

export default knexfile;
