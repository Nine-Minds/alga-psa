#!/usr/bin/env node
import { pathToFileURL } from 'node:url';

export async function readLicenseState(db) {
  const row = await db('license_state').orderBy('id').first();
  if (!row) throw new Error('Not a self-hosted install.');
  const fields = ['edition_choice', 'license_token', 'appliance_id', 'check_in_url', 'last_checkin_at', 'trial_started_at', 'updated_at'];
  return Object.fromEntries(fields.map((key) => [key, row[key] ?? null]));
}
async function main() {
  const { getAdminConnection, destroyAdminConnection } = await import('@alga-psa/db/admin');
  try { console.log(JSON.stringify({ ok: true, row: await readLicenseState(await getAdminConnection()) })); }
  finally { await destroyAdminConnection().catch(() => {}); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.log(JSON.stringify({ ok: false, error: error.message })); process.exitCode = 1; });
}
