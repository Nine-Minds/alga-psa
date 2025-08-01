import pg from 'pg';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import fs from 'fs';
import path from 'path';
import { getSecretProviderInstance } from '../../shared/dist/core/index.js';

// Enable long stack traces for async operations
Error.stackTraceLimit = 50;
process.env.NODE_OPTIONS = '--async-stack-traces';

// Calculate secrets directory path once at module load
const DOCKER_SECRETS_PATH = '/run/secrets';
const LOCAL_SECRETS_PATH = '../secrets';
const SECRETS_PATH = fs.existsSync(DOCKER_SECRETS_PATH) ? DOCKER_SECRETS_PATH : LOCAL_SECRETS_PATH;

async function getSecret(secretName, envVar, defaultValue = '') {
  try {
    const secretProvider = await getSecretProviderInstance();
    const secret = await secretProvider.getAppSecret(secretName);
    if (secret) {
      console.log(`Successfully read secret '${secretName}' from secret provider`);
      return secret;
    }
  } catch (error) {
    console.warn(`Failed to read secret '${secretName}' from secret provider:`, error.message);
  }
  
  // Fallback to environment variable
  if (process.env[envVar]) {
    console.warn(`Using ${envVar} environment variable instead of secret provider`);
    return process.env[envVar] || defaultValue;
  }
  
  console.warn(`Neither secret provider nor ${envVar} environment variable found, using default value`);
  return defaultValue;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const { Client } = pg;

dotenv.config();

const MAX_RETRIES = 5;
const INITIAL_RETRY_DELAY = 1000; // 1 second

/**
 * Configuration validation
 * @throws {Error} If required environment variables are missing
 */
function validateConfig() {
  const required = [
    'DB_HOST',
    'DB_PORT',
    'DB_NAME_SERVER',
    'DB_USER_SERVER',
    'APP_ENV'
  ];

  const missing = required.filter(key => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

/**
 * Attempts to set up the hocuspocus database
 * This is a non-fatal operation - if it fails, we log the error but continue
 */
async function setupHocuspocusDatabase(client, postgresPassword) {
  // Default to 'hocuspocus' if environment variables are not set
  process.env.DB_NAME_HOCUSPOCUS = process.env.DB_NAME_HOCUSPOCUS || 'hocuspocus';
  process.env.DB_USER_HOCUSPOCUS = process.env.DB_USER_HOCUSPOCUS || 'hocuspocus';

  // Get hocuspocus password from secrets or env var
  const hocuspocusPassword = await getSecret('db_password_hocuspocus', 'DB_PASSWORD_HOCUSPOCUS', postgresPassword);

  try {
    // Check if database exists
    const dbCheckResult = await client.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [process.env.DB_NAME_HOCUSPOCUS]
    );

    if (dbCheckResult.rows.length > 0) {
      console.log(`Database ${process.env.DB_NAME_HOCUSPOCUS} already exists`);
    } else {
      await client.query(`CREATE DATABASE ${process.env.DB_NAME_HOCUSPOCUS}`);
      console.log(`Database ${process.env.DB_NAME_HOCUSPOCUS} created successfully`);
    }

    // Connect to the hocuspocus database
    const hocuspocusClient = new Client({
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      user: 'postgres',
      password: postgresPassword,
      database: process.env.DB_NAME_HOCUSPOCUS
    });

    await hocuspocusClient.connect();

    // Check if hocuspocus user exists
    const userCheckResult = await hocuspocusClient.query(
      "SELECT 1 FROM pg_roles WHERE rolname = $1",
      [process.env.DB_USER_HOCUSPOCUS]
    );

    if (userCheckResult.rows.length > 0) {
      console.log(`User ${process.env.DB_USER_HOCUSPOCUS} already exists`);
      // Update password for existing user
      await hocuspocusClient.query(`ALTER USER ${process.env.DB_USER_HOCUSPOCUS} WITH PASSWORD '${hocuspocusPassword}'`);
      console.log(`Updated password for user ${process.env.DB_USER_HOCUSPOCUS}`);
    } else {
      await hocuspocusClient.query(`CREATE USER ${process.env.DB_USER_HOCUSPOCUS} WITH PASSWORD '${hocuspocusPassword}'`);
      console.log(`User ${process.env.DB_USER_HOCUSPOCUS} created successfully`);
    }

    // Grant necessary permissions
    await hocuspocusClient.query(`GRANT ALL PRIVILEGES ON DATABASE ${process.env.DB_NAME_HOCUSPOCUS} TO ${process.env.DB_USER_HOCUSPOCUS}`);
    await hocuspocusClient.query(`GRANT ALL PRIVILEGES ON SCHEMA public TO ${process.env.DB_USER_HOCUSPOCUS}`);

    await hocuspocusClient.end();
    console.log('Hocuspocus database setup completed successfully');
  } catch (error) {
    console.warn('Warning: Hocuspocus database setup failed:', error.message);
    console.log('Continuing with main application setup...');
  }
}

/**
 * Creates database and users with appropriate permissions and RLS policies
 * @param {number} retryCount - Number of retry attempts
 * @returns {Promise<void>}
 */
async function createDatabase(retryCount = 0) {
  try {
    validateConfig();
  } catch (error) {
    console.error('Configuration validation failed:', error.message);
    process.exit(1);
  }

  // Read passwords from secret files
  const postgresPassword = await getSecret('postgres_password', 'DB_PASSWORD_ADMIN');
  if (!postgresPassword) {
    console.error('Error: No postgres password available');
    process.exit(1);
  }

  
  const serverPassword = await getSecret('db_password_server', 'DB_PASSWORD_SERVER');
  if (!serverPassword) {
    console.error('Error: No server password available');
    process.exit(1);
  }

  const client = new Client({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: 'postgres',
    password: postgresPassword,
    database: 'postgres' // Connect to default postgres database
  });

  try {
    console.log(`Attempting to connect to PostgreSQL at ${process.env.DB_HOST}:${process.env.DB_PORT} with user 'postgres'`);
    await client.connect();
    console.log('Connected to PostgreSQL server');

    // Try to set up hocuspocus database (non-fatal if it fails)
    await setupHocuspocusDatabase(client, postgresPassword);

    // Check if database exists
    const dbCheckResult = await client.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [process.env.DB_NAME_SERVER]
    );

    if (dbCheckResult.rows.length > 0) {
      console.log(`Database ${process.env.DB_NAME_SERVER} already exists`);
    } else {
      await client.query(`CREATE DATABASE ${process.env.DB_NAME_SERVER}`);
      console.log(`Database ${process.env.DB_NAME_SERVER} created successfully`);
    }

    // Close connection to postgres database
    await client.end();

    // Connect to the newly created database
    const dbClient = new Client({
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      user: 'postgres',
      password: postgresPassword,
      database: process.env.DB_NAME_SERVER
    });

    await dbClient.connect();

    // Check if database is already fully configured by checking for tenants table
    try {
      const tenantsCheck = await dbClient.query("SELECT 1 FROM information_schema.tables WHERE table_name = 'tenants'");
      if (tenantsCheck.rows.length > 0) {
        console.log('Database appears to be already configured (tenants table exists). Skipping setup.');
        await dbClient.end();
        return;
      }
    } catch (error) {
      console.log('Tenants table not found, proceeding with database setup...');
    }

    // Set Citus mode to sequential for DDL operations if Citus is available
    try {
      await dbClient.query(`SET LOCAL citus.multi_shard_modify_mode TO 'sequential';`);
      console.log('Citus sequential mode enabled');
    } catch (error) {
      // Ignore error if Citus is not installed
      console.log('Citus not detected, continuing with standard PostgreSQL');
    }

    // Create extensions (including vector for pgvector support)
    await dbClient.query(`
      CREATE EXTENSION IF NOT EXISTS "vector";
    `);

    console.log('Database extensions created successfully');

    // Check if app_user exists
    const userCheckResult = await dbClient.query(
      "SELECT 1 FROM pg_roles WHERE rolname = $1",
      [process.env.DB_USER_SERVER]
    );

    if (userCheckResult.rows.length > 0) {
      console.log(`User ${process.env.DB_USER_SERVER} already exists`);
      // Update password for existing user
      await dbClient.query(`ALTER USER ${process.env.DB_USER_SERVER} WITH PASSWORD '${serverPassword}'`);
      console.log(`Updated password for user ${process.env.DB_USER_SERVER}`);
    } else {
      await dbClient.query(`CREATE USER ${process.env.DB_USER_SERVER} WITH PASSWORD '${serverPassword}'`);
      console.log(`User ${process.env.DB_USER_SERVER} created successfully`);
    }

    // Configure database
    await dbClient.query(`ALTER DATABASE ${process.env.DB_NAME_SERVER} SET app.environment = '${process.env.APP_ENV}'`);

    // Ensure postgres user has necessary permissions
    await dbClient.query(`GRANT ALL PRIVILEGES ON DATABASE ${process.env.DB_NAME_SERVER} TO postgres`);
    await dbClient.query(`GRANT ALL PRIVILEGES ON SCHEMA public TO postgres`);
    await dbClient.query(`ALTER USER postgres WITH CREATEDB CREATEROLE`);
    
    // Grant CREATE permission on public schema to postgres user
    await dbClient.query(`ALTER SCHEMA public OWNER TO postgres`);
    await dbClient.query(`GRANT CREATE ON SCHEMA public TO postgres`);

    // Set up RLS and permissions
    console.log('Setting up Row Level Security...');

    // Grant connect permission
    await dbClient.query(`GRANT CONNECT ON DATABASE ${process.env.DB_NAME_SERVER} TO ${process.env.DB_USER_SERVER}`);

    // Grant usage on schema
    await dbClient.query(`GRANT USAGE ON SCHEMA public TO ${process.env.DB_USER_SERVER}`);

    // Grant basic table permissions (but not ALL)
    await dbClient.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${process.env.DB_USER_SERVER}`);
    await dbClient.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${process.env.DB_USER_SERVER}`);

    // Grant sequence permissions
    await dbClient.query(`GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO ${process.env.DB_USER_SERVER}`);
    await dbClient.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE ON SEQUENCES TO ${process.env.DB_USER_SERVER}`);

    console.log('Database setup completed successfully');
    await dbClient.end();
  } catch (error) {
    console.error('Error during database setup:', error);
    
    // Log additional debugging information for authentication errors
    if (error.code === '08P01' || error.message?.includes('SASL') || error.message?.includes('authentication')) {
      console.error('=== AUTHENTICATION ERROR DEBUG INFO ===');
      console.error(`Database Host: ${process.env.DB_HOST}`);
      console.error(`Database Port: ${process.env.DB_PORT}`);
      console.error(`Username: postgres`);
      console.error(`Password source: ${postgresPassword ? 'Available' : 'Missing'}`);
      console.error(`Password length: ${postgresPassword ? postgresPassword.length : 0} characters`);
      console.error(`Secrets path used: ${SECRETS_PATH}`);
      console.error(`Environment variables check:`);
      console.error(`  - DB_PASSWORD_ADMIN: ${process.env.DB_PASSWORD_ADMIN ? 'Set' : 'Not set'}`);
      console.error(`  - DB_HOST: ${process.env.DB_HOST || 'Not set'}`);
      console.error(`  - DB_PORT: ${process.env.DB_PORT || 'Not set'}`);
      console.error('=======================================');
    }
    
    if (retryCount < MAX_RETRIES) {
      const delay = INITIAL_RETRY_DELAY * Math.pow(2, retryCount);
      console.log(`Retrying in ${delay / 1000} seconds... (Attempt ${retryCount + 1}/${MAX_RETRIES})`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return createDatabase(retryCount + 1);
    }
    
    console.error(`Max retries (${MAX_RETRIES}) reached. Database setup failed.`);
    process.exit(1);
  }
}

// Execute database setup
createDatabase().catch(error => {
  console.error('Unhandled error during database setup:', error);
  process.exit(1);
});
