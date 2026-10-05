// globalSetup.js
import dotenv from 'dotenv';
import fs from 'fs';
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

  // devServerStartup.integration.test.ts boots Next against throwaway fixture
  // apps at the repo root. Next's dev watcher outlives close(), so the test
  // cannot remove them itself without an unhandled ENOENT; sweep them here,
  // after every worker has exited.
  return () => {
    const repoRoot = path.resolve(here, '..');
    for (const entry of fs.readdirSync(repoRoot)) {
      if (!entry.startsWith('.tmp-dev-server-fixture-')) continue;
      fs.rmSync(path.join(repoRoot, entry), { recursive: true, force: true });
    }
  };
}
