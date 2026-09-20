// globalSetup.js
import dotenv from 'dotenv';
import path from 'path';
import process from 'process';
import console from 'console';
import { fileURLToPath } from 'url';

export default function () {
  // Some environments set NODE_ENV=production globally, which forces React into production mode
  // and breaks React Testing Library's act() integration. Tests should run with NODE_ENV=test.
  process.env.NODE_ENV = 'test';

  // Use .env.localtest for tests to ensure direct PostgreSQL connection (port 5432)
  // instead of pgbouncer (port 6432) which is configured in .env
  // The .env.localtest is in the repo root, one directory up from this file (server/)
  const here = path.dirname(fileURLToPath(import.meta.url));
  const envPath = path.resolve(here, '..', '.env.localtest');
  console.log('Environment file path:', envPath);
  dotenv.config({ path: envPath });

  // `DB_NAME_SERVER` does not survive a run. `createTestDbConnection()` re-points
  // it at the shared test database as soon as any integration file creates that
  // database (server/test-utils/dbConfig.ts), and the same fork is reused for
  // every file, so by the time a later file reads the variable it names the
  // shared database rather than the one the run was aimed at. That is correct
  // for suites that connect to it, and wrong for suites that build a schema
  // *from* it: coManagedBootstrap pg_dumps this name to seed a disposable clone,
  // and silently cloning the shared database instead produces failures in
  // whichever cases need tables the shared one lacks -- which of them fail
  // depends on nothing but file order. Capture the run's own value once, here,
  // before any test file has had the chance to overwrite it.
  if (process.env.DB_NAME_SERVER && !process.env.ALGA_SCHEMA_SOURCE_DB) {
    process.env.ALGA_SCHEMA_SOURCE_DB = process.env.DB_NAME_SERVER;
  }
}
