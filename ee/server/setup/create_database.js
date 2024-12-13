/* eslint-disable @typescript-eslint/no-require-imports */
/* eslint-disable no-undef */
import pg from 'pg';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import path from 'path';
import ini from 'ini';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const { Client } = pg;

dotenv.config();

// Read config.ini and interpolate environment variables
const configContent = fs.readFileSync('/app/config.ini', 'utf-8');
const interpolatedContent = configContent.replace(/\${([^}]+)}/g, (match, p1) => process.env[p1] || match);
const config = ini.parse(interpolatedContent);

const MAX_RETRIES = 5;
const INITIAL_RETRY_DELAY = 1000; // 1 second

async function createDatabase(retryCount = 0) {
  const client = new Client({
    host: config.database.host,
    port: config.database.port,
    user: config.database.admin_user,
    password: config.database.admin_password,
    database: 'postgres' // Connect to the default postgres database
  });

  try {
    await client.connect();

    // Check if the database already exists
    const dbCheckResult = await client.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [config.database.name]
    );

    if (dbCheckResult.rows.length > 0) {
      console.log(`Database ${config.database.name} already exists. Skipping creation.`);
    } else {
      // Create database if it doesn't exist
      await client.query(`CREATE DATABASE ${config.database.name}`);
      console.log(`Database ${config.database.name} created successfully.`);
    }

    // Check if the user already exists
    const userCheckResult = await client.query(
      "SELECT 1 FROM pg_roles WHERE rolname = $1",
      [config.database.user]
    );

    if (userCheckResult.rows.length > 0) {
      console.log(`User ${config.database.user} already exists. Skipping creation.`);
    } else {
      // Create the user
      await client.query(`CREATE USER ${config.database.user} WITH PASSWORD '${config.database.password}'`);
      console.log(`User ${config.database.user} created successfully.`);
    }

    // Close connection to postgres database
    await client.end();

    // Connect to the newly created database to create extensions
    const appDb = new Client({
      host: config.database.host,
      port: config.database.port,
      user: config.database.admin_user,
      password: config.database.admin_password,
      database: config.database.name
    });

    await appDb.connect();

    // Create extensions required for EE
    await appDb.query(`
      CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
      CREATE EXTENSION IF NOT EXISTS "vector";
    `);

    console.log('Database extensions created successfully');

    // Set environment and grant privileges
    await appDb.query(`ALTER DATABASE ${config.database.name} SET app.environment = '${config.app.environment}'`);
    await appDb.query(`GRANT ALL PRIVILEGES ON DATABASE ${config.database.name} TO ${config.database.user}`);
    
    console.log('Enterprise database setup completed successfully');

    await appDb.end();
  } catch (err) {
    console.error('Error during database setup:', err);
    
    if (retryCount < MAX_RETRIES) {
      const delay = INITIAL_RETRY_DELAY * Math.pow(2, retryCount);
      console.log(`Retrying in ${delay / 1000} seconds...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      await createDatabase(retryCount + 1);
    } else {
      console.error('Max retries reached. Database setup failed.');
      process.exit(1);
    }
  }
}

createDatabase();
