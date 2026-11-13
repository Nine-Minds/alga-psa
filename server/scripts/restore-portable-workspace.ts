#!/usr/bin/env node
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Writable } from 'node:stream';
import { createInterface } from 'node:readline';
import { config } from 'dotenv';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';

const HELP = `Portable workspace restore and activation (installation operator)

Run from server with:
  npm exec -- tsx --tsconfig ../ee/server/tsconfig.json scripts/restore-portable-workspace.ts <options>

  --inspect --archive /absolute/backup.alga
  --apply   --archive /absolute/backup.alga --destination-tenant <new UUID> --administrator-user-id <source UUID> [--max-staged-bytes N]
  --resume  --archive /absolute/backup.alga --destination-tenant <same UUID> --administrator-user-id <source UUID> [--max-staged-bytes N]
  --activate --destination-tenant <restored UUID> --operation-id <retained UUID> --license-file /absolute/own-pro-license.jwt
  --activate-hosted --destination-tenant <restored UUID> --operation-id <retained UUID>
  --password-stdin  Read the new administrator password from a protected pipe (activation only).
  --help    Show this help without connecting to the database.

Restore passphrase: ALGA_PORTABLE_RESTORE_PASSPHRASE or a protected pipe/hidden prompt; never an argument.
Activation requires a NEW administrator password and an independently owned entitlement.
Restored users stay inactive except for the selected administrator; dispatch stays paused.
FORCE_CAPABILITIES=co-managed:off disables restore and activation.
`;

const RESTORE_MODES = ['--inspect', '--apply', '--resume'] as const;
const ACTIVATION_MODES = ['--activate', '--activate-hosted'] as const;
type Options = Record<string, string | true>;

function args(argv: string[]): Options {
  const values: Options = {};
  const modes = [...RESTORE_MODES, ...ACTIVATION_MODES];
  const fields = new Set(['--archive', '--destination-tenant', '--administrator-user-id', '--max-staged-bytes', '--operation-id', '--license-file']);
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (/^--passphrase/.test(key) || /^--password/.test(key) && key !== '--password-stdin') throw new Error('Secrets are never accepted as arguments');
    if (key in values) throw new Error('Repeated option');
    if (modes.includes(key as typeof modes[number]) || key === '--password-stdin' || key === '--help') values[key] = true;
    else if (fields.has(key) && argv[i + 1] && !argv[i + 1].startsWith('--')) values[key] = argv[++i];
    else throw new Error('Unknown option or missing value');
  }
  if (values['--help']) return values;
  const selected = modes.filter(key => values[key]);
  if (selected.length !== 1) throw new Error('Choose one restore or activation mode');
  const mode = selected[0];
  if ((RESTORE_MODES as readonly string[]).includes(mode)) {
    if (typeof values['--archive'] !== 'string' || values['--operation-id'] || values['--license-file'] || values['--password-stdin']) throw new Error('Restore options are invalid');
    if (mode === '--inspect') {
      if (['--destination-tenant', '--administrator-user-id', '--max-staged-bytes'].some(key => values[key])) throw new Error('Inspect does not take restore options');
    } else if (typeof values['--destination-tenant'] !== 'string' || typeof values['--administrator-user-id'] !== 'string') {
      throw new Error('Restore requires destination and source administrator UUIDs');
    }
    if ('--max-staged-bytes' in values && !/^[1-9][0-9]{0,15}$/.test(String(values['--max-staged-bytes']))) throw new Error('Invalid staged-bytes cap');
  } else {
    if (values['--archive'] || values['--administrator-user-id'] || values['--max-staged-bytes'] ||
        typeof values['--destination-tenant'] !== 'string' || typeof values['--operation-id'] !== 'string' ||
        (mode === '--activate' && typeof values['--license-file'] !== 'string') || (mode === '--activate-hosted' && values['--license-file'])) {
      throw new Error('Activation options are invalid');
    }
  }
  return values;
}

/** Shared release gate for every restore and activation mode. */
const capabilityForcedOff = async () => {
  const { forcedValue } = await import('@alga-psa/core/capability');
  const state = forcedValue(process.env.FORCE_CAPABILITIES, 'co-managed');
  return state === 'off' || state === 'malformed';
};

async function secretInput(label: string, envName?: string, allowPipe = false): Promise<string> {
  const fromEnv = envName ? process.env[envName] : undefined;
  if (envName) delete process.env[envName];
  if (fromEnv) return fromEnv;
  if (!process.stdin.isTTY) {
    if (!allowPipe) throw new Error('Password stdin requires --password-stdin');
    const chunks: Buffer[] = []; let size = 0;
    try {
      for await (const input of process.stdin) {
        const chunk = Buffer.from(input); chunks.push(chunk); size += chunk.length;
        if (size > 1024) throw new Error('Secret exceeds 1024 UTF-8 bytes');
      }
      const bytes = Buffer.concat(chunks);
      try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } finally { bytes.fill(0); }
    } finally { for (const chunk of chunks) chunk.fill(0); }
  }
  if (!process.stderr.isTTY) throw new Error('Use a protected pipe or interactive terminal');
  process.stderr.write(`${label}: `);
  const hidden = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  const rl = createInterface({ input: process.stdin, output: hidden, terminal: true });
  try { return await new Promise<string>((resolveSecret, reject) => {
    rl.once('line', resolveSecret); rl.once('SIGINT', () => reject(new Error('Cancelled')));
    rl.once('close', () => reject(new Error('Secret input closed')));
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
  if (await capabilityForcedOff()) throw new Error('Capability disabled');
  const mode = [...RESTORE_MODES, ...ACTIVATION_MODES].find(key => options[key])!;
  if ((RESTORE_MODES as readonly string[]).includes(mode)) {
    phase = 'passphrase input';
    let phrase = await secretInput('Archive passphrase', 'ALGA_PORTABLE_RESTORE_PASSPHRASE', true);
    let db: import('knex').Knex | undefined;
    try {
      if (Buffer.byteLength(phrase, 'utf8') < 16 || Buffer.byteLength(phrase, 'utf8') > 1024) throw new Error('Invalid secret length');
      phase = 'restore module loading';
      // Dynamic import is required because the storage package is import-only.
      const restore = await import('../../ee/server/src/lib/co-managed/portableWorkspaceRestore');
      const archivePath = resolve(String(options['--archive']));
      if (mode === '--inspect') {
        phase = 'archive inspection';
        process.stdout.write(`${JSON.stringify(await restore.inspectPortableWorkspaceArchive(archivePath, phrase), null, 2)}\n`);
        return;
      }
      phase = 'database connection';
      const { getAdminConnection } = await import('@alga-psa/db/admin');
      db = await getAdminConnection();
      phase = 'workspace restore';
      const result = await restore.restorePortableWorkspaceForInstallation(db, { archivePath, passphrase: phrase, resume: mode === '--resume',
        destinationTenant: String(options['--destination-tenant']), sourceAdministratorUserId: String(options['--administrator-user-id']),
        ...(options['--max-staged-bytes'] ? { maxStagedBytes: Number(options['--max-staged-bytes']) } : {}) });
      process.stdout.write(`${JSON.stringify({ ...result, status: 'restored; the tenant remains suspended pending activation' }, null, 2)}\n`);
    } finally { phrase = ''; await db?.destroy(); }
    return;
  }

  phase = 'password input';
  let secret = await secretInput('New administrator password', undefined, !!options['--password-stdin']);
  let db: import('knex').Knex | undefined;
  try {
    if (!options['--password-stdin'] && secret !== await secretInput('Confirm administrator password')) throw new Error('Passwords differ');
    if (Buffer.byteLength(secret, 'utf8') < 8 || Buffer.byteLength(secret, 'utf8') > 1024) throw new Error('Invalid secret length');
    phase = 'activation module loading';
    const require = createRequire(import.meta.url);
    const { activatePortableWorkspaceWithTenantLicense, activatePortableWorkspaceWithHostedSubscription } = require('../../ee/server/src/lib/co-managed/portableWorkspaceActivation') as typeof import('../../ee/server/src/lib/co-managed/portableWorkspaceActivation');
    const { getAdminConnection } = require('@alga-psa/db/admin') as typeof import('@alga-psa/db/admin');
    phase = 'database connection'; db = await getAdminConnection();
    phase = 'workspace activation';
    const activation = { tenant: String(options['--destination-tenant']), operationId: String(options['--operation-id']), administratorPassword: secret };
    const log = { info() {}, error() {} };
    const receipt = mode === '--activate-hosted' ? await activatePortableWorkspaceWithHostedSubscription(db, activation, log)
      : await activatePortableWorkspaceWithTenantLicense(db, { ...activation, licenseToken: await licenseFile(String(options['--license-file'])) }, log);
    process.stdout.write(`${JSON.stringify({ ...receipt, status: 'activation recorded; review current workspace and workflow state before use' }, null, 2)}\n`);
  } finally { secret = ''; await db?.destroy(); }
}

main().catch(() => {
  // Provider/database errors may contain secrets. Keep operator failure output bounded and redacted.
  process.stderr.write(`Portable workspace operation failed during ${phase}. Check options, archive or entitlement, destination identity, storage and database authority.\n`);
  process.exitCode = 1;
});
