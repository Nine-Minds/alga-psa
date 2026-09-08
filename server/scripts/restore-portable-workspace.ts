#!/usr/bin/env node
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Writable } from 'node:stream';
import { createInterface } from 'node:readline';
import { config } from 'dotenv';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';

const HELP = `Portable workspace restore (installation operator)

Run from server with:
  npm exec -- tsx --tsconfig ../ee/server/tsconfig.json scripts/restore-portable-workspace.ts <options>

  --inspect --archive /absolute/backup.alga
  --restore --archive /absolute/backup.alga --destination-tenant <new UUID> --administrator-user-id <source UUID>
  --activate --destination-tenant <restored UUID> --operation-id <retained UUID> --license-file /absolute/own-pro-license.jwt
  --passphrase-stdin    Read exact UTF-8 passphrase bytes from a protected pipe (no trailing newline).
  --password-stdin      Read the new administrator password from a protected pipe for activation.
  --help               Show this help without connecting to the database.

The default passphrase prompt hides input. Passphrases are never command arguments.
Inspect lists eligible source administrators after authenticating the archive.
Restore requires database owner credentials and a destination UUID you retain for retries.
The imported tenant remains suspended until activation with its own signed Pro license.
Activation enables its selected administrator; other users and restored dispatch remain inactive.
`;

function args(argv: string[]) {
  const values: Record<string, string | true> = {};
  const flags = new Set(['--inspect', '--restore', '--activate', '--passphrase-stdin', '--password-stdin', '--help']);
  const fields = new Set(['--archive', '--destination-tenant', '--administrator-user-id', '--operation-id', '--license-file']);
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key in values) throw new Error('Repeated option');
    if (flags.has(key)) values[key] = true;
    else if (fields.has(key) && argv[i + 1] && !argv[i + 1].startsWith('--')) values[key] = argv[++i];
    else throw new Error('Unknown option or missing value');
  }
  if (values['--help']) return values;
  if (['--inspect', '--restore', '--activate'].filter(key => values[key]).length !== 1) throw new Error('Choose inspect, restore or activate');
  if (values['--activate']) {
    if (['--destination-tenant', '--operation-id', '--license-file'].some(key => typeof values[key] !== 'string') ||
        values['--archive'] || values['--administrator-user-id'] || values['--passphrase-stdin']) throw new Error('Activation requires destination, operation UUID and license file');
    return values;
  }
  if (typeof values['--archive'] !== 'string' || values['--password-stdin'] || values['--operation-id'] || values['--license-file']) throw new Error('Archive operation options are invalid');
  if (values['--restore'] && (typeof values['--destination-tenant'] !== 'string' || typeof values['--administrator-user-id'] !== 'string')) throw new Error('Restore requires destination and source administrator UUIDs');
  if (values['--inspect'] && (values['--destination-tenant'] || values['--administrator-user-id'])) throw new Error('Inspect does not take restore identities');
  return values;
}

async function passphrase(fromPipe: boolean, label = 'Archive passphrase'): Promise<string> {
  if (fromPipe) {
    if (process.stdin.isTTY) throw new Error('Passphrase stdin requires a protected pipe');
    const chunks: Buffer[] = []; let size = 0;
    try {
      for await (const input of process.stdin) {
        const chunk = Buffer.from(input); chunks.push(chunk); size += chunk.length;
        if (size > 1024) throw new Error('Passphrase exceeds 1024 UTF-8 bytes');
      }
      const bytes = Buffer.concat(chunks);
      try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } finally { bytes.fill(0); }
    } finally { for (const chunk of chunks) chunk.fill(0); }
  }
  if (!process.stdin.isTTY || !process.stderr.isTTY) throw new Error('Use an interactive terminal or --passphrase-stdin');
  process.stderr.write(`${label}: `);
  const hidden = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  const rl = createInterface({ input: process.stdin, output: hidden, terminal: true });
  try { return await new Promise<string>((resolve, reject) => {
    rl.once('line', resolve);
    rl.once('SIGINT', () => reject(new Error('Cancelled')));
    rl.once('close', () => reject(new Error('Passphrase input closed')));
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
  phase = 'passphrase input';
  let phrase = await passphrase(!!options[options['--activate'] ? '--password-stdin' : '--passphrase-stdin'],
    options['--activate'] ? 'New administrator password' : 'Archive passphrase');
  let db: import('knex').Knex | undefined;
  try {
    if (options['--activate'] && !options['--password-stdin'] && phrase !== await passphrase(false, 'Confirm administrator password')) throw new Error('Passwords differ');
    if (Buffer.byteLength(phrase, 'utf8') < (options['--activate'] ? 8 : 16) || Buffer.byteLength(phrase, 'utf8') > 1024) throw new Error('Invalid secret length');
    // EE sources are CJS under tsx; defer loading them until after help/input.
    phase = 'restore module loading';
    const require = createRequire(import.meta.url);
    if (options['--activate']) {
      const { activatePortableWorkspaceWithTenantLicense } = require('../../ee/server/src/lib/co-managed/portableWorkspaceActivation') as typeof import('../../ee/server/src/lib/co-managed/portableWorkspaceActivation');
      const { getAdminConnection } = require('@alga-psa/db/admin') as typeof import('@alga-psa/db/admin');
      phase = 'database connection'; db = await getAdminConnection();
      phase = 'workspace activation';
      const receipt = await activatePortableWorkspaceWithTenantLicense(db, { tenant: String(options['--destination-tenant']), operationId: String(options['--operation-id']),
        licenseToken: await licenseFile(String(options['--license-file'])), administratorPassword: phrase }, { info() {}, error() {} });
      process.stdout.write(`${JSON.stringify({ ...receipt, status: 'activation recorded; restored workflows and other users remain inactive' }, null, 2)}\n`);
      return;
    }
    const restore = require('../../ee/server/src/lib/co-managed/portableWorkspaceRestore') as typeof import('../../ee/server/src/lib/co-managed/portableWorkspaceRestore');
    const archivePath = resolve(String(options['--archive']));
    if (options['--inspect']) {
      phase = 'archive inspection';
      process.stdout.write(`${JSON.stringify(await restore.inspectPortableWorkspaceArchive(archivePath, phrase), null, 2)}\n`);
    } else {
      phase = 'database connection';
      const { getAdminConnection } = require('@alga-psa/db/admin') as typeof import('@alga-psa/db/admin');
      db = await getAdminConnection();
      phase = 'workspace restore';
      const receipt = await restore.restorePortableWorkspaceForInstallation(db, { archivePath, passphrase: phrase,
        destinationTenant: String(options['--destination-tenant']), sourceAdministratorUserId: String(options['--administrator-user-id']) });
      process.stdout.write(`${JSON.stringify({ ...receipt, status: 'restored; inspect tenant activation state before use' }, null, 2)}\n`);
    }
  } finally { phrase = ''; await db?.destroy(); }
}

main().catch(() => {
  // Provider/database errors may contain secrets or imported values. Keep the
  // operator failure output deliberately bounded and never print raw errors.
  process.stderr.write(`Portable workspace operation failed during ${phase}. Check options, archive passphrase, destination identity, storage, and database authority.\n`);
  process.exitCode = 1;
});
