/* eslint-disable @typescript-eslint/no-require-imports */
/* eslint-disable no-undef */
require('dotenv').config();
const fs = require('fs');

const DatabaseType = {
  postgres: 'postgres'
};

const externals = {
  [DatabaseType.postgres]: 'pg'
  // Add more alternatives as needed
};

const isValidDbType = (type) => {
  return type !== undefined && Object.keys(externals).includes(type);
};

const getClient = () => {
  const dbType = process.env.DB_TYPE;

  if (isValidDbType(dbType)) {
    return externals[dbType];
  }

  console.warn(`Invalid or missing DB_TYPE: ${dbType}. Defaulting to postgres.`);
  return externals[DatabaseType.postgres];
};

const createConnectionWithTenant = (config, tenant) => {
  return {
    ...config,
    pool: {
      ...config.pool,
      afterCreate: (conn, done) => {
        conn.query(`SET SESSION "app.current_tenant" = '${tenant}';`, (err) => {
          if (err) {
            console.error('Error setting tenant:', err);
          }
          done(err, conn);
        });
      },
    },
  };
};

// Read database passwords from secret files
const getPostgresPassword = () => {
  try {
    return fs.readFileSync('/run/secrets/postgres_password', 'utf8').trim();
  } catch (error) {
    console.error('Error reading postgres password:', error.message);
    process.exit(1);
  }
};

const getAppUserPassword = () => {
  try {
    return fs.readFileSync('/run/secrets/db_password_server', 'utf8').trim();
  } catch (error) {
    console.error('Error reading server password:', error.message);
    process.exit(1);
  }
};

// Base configuration for migrations (uses postgres user)
const migrationConfig = {
  client: 'pg',
  connection: {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: 'postgres',
    password: getPostgresPassword(),
    database: process.env.DB_NAME_SERVER,
  },
  pool: {
    min: 2,
    max: 20,
  },
  migrations: {
    directory: "./migrations"
  }
};

// Base configuration for application (uses app_user)
const appConfig = {
  client: 'pg',
  connection: {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER_SERVER || 'app_user',
    password: getAppUserPassword(),
    database: process.env.DB_NAME_SERVER,
  },
  pool: {
    min: 2,
    max: 20,
  }
};

const knexfile = {
  development: {
    // Development uses app_user for normal operations
    ...appConfig,
    // But keeps postgres user connection for migrations
    migrations: migrationConfig.migrations,
    seeds: {
      directory: "./seeds/dev",
      loadExtensions: ['.cjs', '.js']
    }
  },
  test: {
    client: 'pg',
    connection: {
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || '5432',
      user: process.env.DB_USER_SERVER || 'app_user',
      password: process.env.DB_PASSWORD_SERVER || 'test_password',
      database: process.env.DB_NAME_SERVER || 'sebastian_test',
    },
    pool: {
      min: 2,
      max: 20,
    },
    migrations: migrationConfig.migrations,
  },
  production: {
    // Production uses app_user for normal operations
    ...appConfig,
    // But keeps postgres user connection for migrations
    migrations: migrationConfig.migrations,
  },
  local: {
    client: 'postgresql',
    connection: {
      host: 'localhost',
      port: '5432',
      user: process.env.DB_USER_SERVER || 'app_user',
      password: process.env.DB_PASSWORD_SERVER || 'abcd1234!',
      database: process.env.DB_NAME_SERVER || 'server',
    },
    migrations: migrationConfig.migrations,
  },
  // Special config just for running migrations (uses postgres user)
  migration: migrationConfig
};

module.exports = {
  ...knexfile,
  createConnectionWithTenant,
};
