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
      return process.env[envVar] || '';
    }
    console.warn(`Neither secret file ${secretPath} nor ${envVar} environment variable found, using empty string`);
    return '';
  }
};

const getDbPassword = () => getPassword('/run/secrets/db_password_server', 'DB_PASSWORD_SERVER');
const getPostgresPassword = () => getPassword('/run/secrets/postgres_password', 'POSTGRES_PASSWORD');

// Special connection config for postgres user (needed for job scheduler)
export const postgresConnection = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 5432,
  user: 'postgres',
  password: getPostgresPassword(),
  database: process.env.DB_NAME_SERVER || 'postgres'
} satisfies Knex.PgConnectionConfig;

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

const knexfile: Record<string, CustomKnexConfig> = {
  development: {
    client: 'pg',
    connection: {
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT) || 5432,
      user: process.env.DB_USER_SERVER || 'postgres',
      password: getDbPassword(),
      database: process.env.DB_NAME_SERVER || 'postgres'
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
      user: process.env.DB_USER_SERVER || 'postgres',
      password: getDbPassword(),
      database: process.env.DB_NAME_SERVER || 'postgres'
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
      destroyTimeoutMillis: 5000
    }
  }
};

export const getKnexConfigWithTenant = (tenant: string): CustomKnexConfig => {
  const env = process.env.APP_ENV || 'development';
  const config = { ...knexfile[env] };
  
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

export default knexfile;
