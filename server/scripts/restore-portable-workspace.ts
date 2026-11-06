#!/usr/bin/env node
// CM L8b owns the ACTIVATION half of this CLI. `--inspect`, `--restore` and `--cleanup-uploads` belong to
// CM L7b2, which adds them to the same option table and dispatcher below.
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Writable } from 'node:stream';
import { createInterface } from 'node:readline';
import { config } from 'dotenv';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';

const HELP = `Portable workspace activation (installation operator)

Run from server with:
  npm exec -- tsx --tsconfig ../ee/server/tsconfig.json scripts/restore-portable-workspace.ts <options>

  --activate --destination-tenant <restored UUID> --operation-id <retained UUID> --license-file /absolute/own-pro-license.jwt
  --activate-hosted --destination-tenant <restored UUID> --operation-id <retained UUID>
  --password-stdin      Read the new administrator password from a protected pipe.
  --help               Show this help without connecting to the database.

Activation accepts only a licence or subscription the customer owns, plus a NEW administrator password.
The restored administrator is enabled; other users and restored dispatch remain inactive.
The activation receipt is printed as JSON.
`;

function args(argv: string[]) {
  const values: Record<string, string | true> = {};
  const flags = new Set(['--activate', '--activate-hosted', '--password-stdin', '--help']);
  const fields = new Set(['--destination-tenant', '--operation-id', '--license-file']);
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key in values) throw new Error('Repeated option');
    if (flags.has(key)) values[key] = true;
    else if (fields.has(key) && argv[i + 1] && !argv[i + 1].startsWith('--')) values[key] = argv[++i];
    else throw new Error('Unknown option or missing value');
  }
  if (values['--help']) return values;
  if (['--activate', '--activate-hosted'].filter(key => values[key]).length !== 1) throw new Error('Choose activate or activate-hosted');
  if (['--destination-tenant', '--operation-id'].some(key => typeof values[key] !== 'string') ||
      (values['--activate'] && typeof values['--license-file'] !== 'string') ||
      (values['--activate-hosted'] && values['--license-file'])) throw new Error('Activation options are invalid');
  return values;
}

async function password(fromPipe: boolean, label: string): Promise<string> {
  if (fromPipe) {
    if (process.stdin.isTTY) throw new Error('Password stdin requires a protected pipe');
    const chunks: Buffer[] = []; let size = 0;
    try {
      for await (const input of process.stdin) {
        const chunk = Buffer.from(input); chunks.push(chunk); size += chunk.length;
        if (size > 1024) throw new Error('Password exceeds 1024 UTF-8 bytes');
      }
      const bytes = Buffer.concat(chunks);
      try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } finally { bytes.fill(0); }
    } finally { for (const chunk of chunks) chunk.fill(0); }
  }
  if (!process.stdin.isTTY || !process.stderr.isTTY) throw new Error('Use an interactive terminal or --password-stdin');
  process.stderr.write(`${label}: `);
  const hidden = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  const rl = createInterface({ input: process.stdin, output: hidden, terminal: true });
  try { return await new Promise<string>((resolvePassword, reject) => {
    rl.once('line', resolvePassword);
    rl.once('SIGINT', () => reject(new Error('Cancelled')));
    rl.once('close', () => reject(new Error('Password input closed')));
  }); } finally { rl.close(); hidden.end(); process.stderr.write('\n'); }
}

async function licenseFile(path: string): Promise<string> {
  const file = await open(resolve(path), constants.O_RDONLY | constants.O_NOFOLLOW);
  const bytes = Buffer.alloc(16_385);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size < 1 || stat.size > 16_384) throw new Error('Invalid license file');
    let size = 0;
    while (size < bytes.length) { const read = await file.read(bytes, size, bytes.length - size); if (!read.bytesRead) break; size += read.bytesRead; }
    if (size !== stat.size) throw new Error('License file changed');
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, size));
  } finally { bytes.fill(0); await file.close(); }
}

let phase = 'options';
async function main() {
  const options = args(process.argv.slice(2));
  if (options['--help']) { process.stdout.write(HELP); return; }
  phase = 'environment';
  config({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true });
  phase = 'password input';
  let secret = await password(!!options['--password-stdin'], 'New administrator password');
  let db: import('knex').Knex | undefined;
  try {
    if (!options['--password-stdin'] && secret !== await password(false, 'Confirm administrator password')) throw new Error('Passwords differ');
    if (Buffer.byteLength(secret, 'utf8') < 8 || Buffer.byteLength(secret, 'utf8') > 1024) throw new Error('Invalid secret length');
    // EE sources are CJS under tsx; defer loading them until after help/input.
    phase = 'activation module loading';
    const require = createRequire(import.meta.url);
    const { activatePortableWorkspaceWithTenantLicense, activatePortableWorkspaceWithHostedSubscription } = require('../../ee/server/src/lib/co-managed/portableWorkspaceActivation') as typeof import('../../ee/server/src/lib/co-managed/portableWorkspaceActivation');
    const { getAdminConnection } = require('@alga-psa/db/admin') as typeof import('@alga-psa/db/admin');
    phase = 'database connection'; db = await getAdminConnection();
    phase = 'workspace activation';
    const activation = { tenant: String(options['--destination-tenant']), operationId: String(options['--operation-id']), administratorPassword: secret };
    const log = { info() {}, error() {} };
    const receipt = options['--activate-hosted'] ? await activatePortableWorkspaceWithHostedSubscription(db, activation, log)
      : await activatePortableWorkspaceWithTenantLicense(db, { ...activation, licenseToken: await licenseFile(String(options['--license-file'])) }, log);
    process.stdout.write(`${JSON.stringify({ ...receipt, status: 'activation recorded; review current workspace and workflow state before use' }, null, 2)}\n`);
  } finally { secret = ''; await db?.destroy(); }
}

main().catch(() => {
  // Provider/database errors may contain secrets. Keep operator failure output bounded.
  process.stderr.write(`Portable workspace activation failed during ${phase}. Check options, licence or subscription, destination identity and database authority.\n`);
  process.exitCode = 1;
});
