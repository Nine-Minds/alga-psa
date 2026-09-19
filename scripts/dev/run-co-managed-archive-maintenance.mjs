// Run co-managed archive maintenance against a live stack from PLAIN NODE --
// no bundler, no vitest, no Next. This is the execution path packages/jobs'
// coManagedUploadCleanupHandler takes in the worker, which is why it is the
// proof that the built co-managed barrel actually loads.
import { readFileSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '../..');

// The `.env.local` trap: `set -a; . ./.env.local` leaves DB_PASSWORD_SERVER and
// REDIS_PASSWORD EMPTY, because both values contain an unquoted `&` which bash
// parses as the background operator. Parse line by line instead.
const envPath = resolvePath(REPO_ROOT, 'server/.env.local');
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eq = trimmed.indexOf('=');
  if (eq === -1) continue;
  const key = trimmed.slice(0, eq).trim();
  let value = trimmed.slice(eq + 1);
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  if (!(key in process.env)) process.env[key] = value;
}
console.log(`[env] DB_PASSWORD_SERVER length=${(process.env.DB_PASSWORD_SERVER ?? '').length} (must be > 0)`);

// Direct PostgreSQL. pgbouncer on the default port only routes server/postgres.
process.env.DB_HOST = '127.0.0.1';
process.env.DB_PORT = '5472';
process.env.DB_NAME_SERVER = 'server_co_managed';
process.env.DB_NAME = 'server_co_managed';

// MSP tenant "Oz" in the review database; override with CO_MANAGED_TENANT.
const TENANT = process.env.CO_MANAGED_TENANT ?? '569e72fc-52d9-4ce2-838e-a34ea8cf2f9f';

const t0 = Date.now();
console.log('[load] importing the BUILT co-managed barrel from plain Node...');
const coManaged = await import(pathToFileURL(resolvePath(REPO_ROOT, 'packages/co-managed/dist/index.js')).href);
console.log(`[load] ok in ${Date.now() - t0}ms; ${Object.keys(coManaged).length} exports`);

for (const name of ['cleanupCoManagedUploads', 'storeCoManagedArchiveFiles', 'cleanupCoManagedThreadTransfers', 'finalizeCoManagedArchive']) {
  console.log(`[load]   ${name}: ${typeof coManaged[name]}`);
}

const { getConnection } = await import('@alga-psa/db');
const { StorageProviderFactory } = await import('@alga-psa/storage/StorageProviderFactory');

const db = await getConnection(TENANT);
console.log('[db] connected to', (await db.raw('select current_database() as d')).rows[0].d);

const deleted = [];
const remove = async (path) => {
  deleted.push(path);
  console.log('[storage] delete', path);
  return (await StorageProviderFactory.createProvider()).delete(path);
};

console.log('[run] cleanupCoManagedUploads...');
const uploads = await coManaged.cleanupCoManagedUploads(db, TENANT, remove, 50);
console.log('[run] uploads ->', JSON.stringify(uploads));

console.log('[run] storeCoManagedArchiveFiles (the archive sweep)...');
const archiveFiles = await coManaged.storeCoManagedArchiveFiles(db, TENANT, 50);
console.log('[run] archiveFiles ->', JSON.stringify(archiveFiles));

console.log('[run] cleanupCoManagedThreadTransfers...');
const transfers = await coManaged.cleanupCoManagedThreadTransfers(db, TENANT, remove, 50);
console.log('[run] transfers ->', JSON.stringify(transfers));

console.log(`[done] total ${Date.now() - t0}ms; ${deleted.length} storage objects removed`);
await db.destroy();
process.exit(0);
