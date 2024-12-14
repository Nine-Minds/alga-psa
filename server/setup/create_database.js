import pg from 'pg';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import fs from 'fs';

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
  if (!process.env.DB_NAME_HOCUSPOCUS || !process.env.DB_USER_HOCUSPOCUS) {
    console.log('Skipping Hocuspocus setup - environment variables not configured');
    return;
  }

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
    } else {
      await hocuspocusClient.query(`CREATE USER ${process.env.DB_USER_HOCUSPOCUS} WITH PASSWORD '${postgresPassword}'`);
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
  let postgresPassword;
  try {
    postgresPassword = fs.readFileSync('/run/secrets/postgres_password', 'utf8').trim();
  } catch (error) {
    console.error('Error reading postgres password:', error.message);
    process.exit(1);
  }

  let serverPassword;
  try {
    serverPassword = fs.readFileSync('/run/secrets/db_password_server', 'utf8').trim();
  } catch (error) {
    console.error('Error reading server password:', error.message);
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

    // Enable RLS on all tables
    await dbClient.query(`
      DO $$
      DECLARE
        r RECORD;
      BEGIN
        FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public')
        LOOP
          EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', r.tablename);
        END LOOP;
      END $$;
    `);

    // Create tenant_id function for RLS
    await dbClient.query(`
      CREATE OR REPLACE FUNCTION current_tenant_id()
      RETURNS TEXT AS $$
      BEGIN
        RETURN current_setting('app.current_tenant', TRUE);
      END;
      $$ LANGUAGE plpgsql;
    `);

    console.log('Database setup completed successfully');
    await dbClient.end();
  } catch (error) {
    console.error('Error during database setup:', error);
    
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
