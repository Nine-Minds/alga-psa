// globalSetup.js
import dotenv from 'dotenv';
import path from 'path';
import process from 'process';
import console from 'console';
import { fileURLToPath } from 'url';

export default function () {
  // Use .env.localtest for tests to ensure direct PostgreSQL connection (port 5432)
  // instead of pgbouncer (port 6432) which is configured in .env
  // The .env.localtest is in the repo root, one directory up from this file (server/)
  const here = path.dirname(fileURLToPath(import.meta.url));
  const envPath = path.resolve(here, '..', '.env.localtest');
  console.log('Environment file path:', envPath);
  dotenv.config({ path: envPath });
}
