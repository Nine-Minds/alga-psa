/* eslint-disable @typescript-eslint/no-require-imports */
/* eslint-disable no-undef */
require('dotenv').config();
const fs = require('fs');
const path = require('path');

// Calculate secrets directory path once at module load
const DOCKER_SECRETS_PATH = '/run/secrets';
const LOCAL_SECRETS_PATH = '../secrets';
const SECRETS_PATH = fs.existsSync(DOCKER_SECRETS_PATH) ? DOCKER_SECRETS_PATH : LOCAL_SECRETS_PATH;

/**
 * Gets a secret value from either a Docker secret file or environment variable
 * @param secretName - Name of the secret (e.g. 'postgres_password')
 * @param envVar - Name of the fallback environment variable
 * @param defaultValue - Optional default value if neither source exists
 * @returns The secret value as a string
 */
function getSecret(secretName, envVar, defaultValue = '') {
  // Prioritize environment variables during build/dev (when /run/secrets likely doesn't exist)
  if (!fs.existsSync(DOCKER_SECRETS_PATH) && process.env[envVar]) {
    // console.warn(`Using ${envVar} environment variable (build/dev mode)`); // Reduce noise
    return process.env[envVar] || defaultValue;
  }

  // Try reading from Docker secret file (runtime or mounted build secret)
  const secretPath = path.join(SECRETS_PATH, secretName);
  try {
    // Check if file exists before reading
    if (fs.existsSync(secretPath)) {
        return fs.readFileSync(secretPath, 'utf8').trim();
    }
  } catch (error) {
      // Log error only if it's not ENOENT (file not found)
      if (error.code !== 'ENOENT') {
          console.error(`Error reading secret file ${secretPath}:`, error);
      }
  }

  // Fallback to environment variable if secret file read failed or didn't exist
  if (process.env[envVar]) {
    console.warn(`Using ${envVar} environment variable as fallback`);
    return process.env[envVar] || defaultValue;
  }

  // Final fallback to default value
  console.warn(`Neither secret file ${secretPath} nor ${envVar} environment variable found. Using default value.`);
  return defaultValue;
}

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

const { validate: uuidValidate } = require('uuid');

function isValidTenantId(tenantId) {
  if (!tenantId) return true;
  if (tenantId === 'default') return true;
  return uuidValidate(tenantId);
}

const createConnectionWithTenant = (config, tenant) => {
  if (!isValidTenantId(tenant)) {
    throw new Error('Invalid tenant ID format');
  }

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

// Base configuration for migrations (uses postgres user)
const migrationConfig = {
  client: 'pg',
  connection: {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER_ADMIN || 'postgres',
    password: getSecret('postgres_password', 'DB_PASSWORD_ADMIN'),
    database: process.env.DB_NAME_SERVER,
  },
  pool: {
    min: 0,
    max: 20,
  },
  migrations: {
    directory: "./migrations"
  },
  seeds: {
    directory: "./seeds/dev",
    loadExtensions: ['.cjs', '.js']
  }
};

// Base configuration for application (uses app_user)
const appConfig = {
  client: 'pg',
  connection: {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER_SERVER || 'app_user',
    password: getSecret('db_password_server', 'DB_PASSWORD_SERVER'),
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
      user: process.env.DB_USER_ADMIN || 'postgres',
      password: getSecret('db_password_server', 'DB_PASSWORD_SERVER', 'test_password'),
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
      user: process.env.DB_USER_SERVER || 'postgres',
      password: getSecret('db_password_server', 'DB_PASSWORD_SERVER', 'abcd1234!'),
      database: process.env.DB_NAME_SERVER || 'server',
    },
    migrations: migrationConfig.migrations,
  },
  // Special config just for running migrations (uses postgres user)
  migration: migrationConfig
};

// console.log('/server knexfile', knexfile);

module.exports = {
  ...knexfile,
  createConnectionWithTenant,
};
