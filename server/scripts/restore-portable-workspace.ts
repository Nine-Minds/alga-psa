#!/usr/bin/env node
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Writable } from 'node:stream';
import { createInterface } from 'node:readline';
import { config } from 'dotenv';

const HELP = `Portable workspace restore (installation operator; restore half only)

Run from server with:
  npm exec -- tsx --tsconfig ../ee/server/tsconfig.json scripts/restore-portable-workspace.ts <options>

  --inspect --archive /absolute/backup.alga
  --apply   --archive /absolute/backup.alga --destination-tenant <new UUID> --administrator-user-id <source UUID> [--max-staged-bytes N]
  --resume  --archive /absolute/backup.alga --destination-tenant <same UUID> --administrator-user-id <source UUID> [--max-staged-bytes N]
  --help    Show this help without connecting to the database.

Passphrase: read from the ALGA_PORTABLE_RESTORE_PASSPHRASE environment variable, else from stdin (a protected
pipe, exact UTF-8 bytes, or a hidden terminal prompt). It is never accepted as a command argument; any
--passphrase option is rejected.
Staged bytes are capped (default 16 GiB; --max-staged-bytes overrides) before any storage write.
The restored tenant stays suspended (portable_restore_suspensions) until a later activation step; this tool
performs no activation or billing. FORCE_CAPABILITIES=co-managed:off disables it entirely.
`;

const MODES = ['--inspect', '--apply', '--resume'];
function args(argv: string[]) {
  const values: Record<string, string | true> = {};
  const fields = new Set(['--archive', '--destination-tenant', '--administrator-user-id', '--max-staged-bytes']);
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (/^--passphrase/.test(key) || /^--password/.test(key)) throw new Error('Secrets are never accepted as arguments');
    if (key in values) throw new Error('Repeated option');
    if (MODES.includes(key) || key === '--help') values[key] = true;
    else if (fields.has(key) && argv[i + 1] && !argv[i + 1].startsWith('--')) values[key] = argv[++i];
    else throw new Error('Unknown option or missing value');
  }
  if (values['--help']) return values;
  if (MODES.filter(key => values[key]).length !== 1) throw new Error('Choose inspect, apply or resume');
  if (typeof values['--archive'] !== 'string') throw new Error('Archive required');
  if (values['--inspect']) {
    if (['--destination-tenant', '--administrator-user-id', '--max-staged-bytes'].some(key => values[key])) throw new Error('Inspect does not take restore options');
  } else if (typeof values['--destination-tenant'] !== 'string' || typeof values['--administrator-user-id'] !== 'string') {
    throw new Error('Restore requires destination and source administrator UUIDs');
  }
  if ('--max-staged-bytes' in values && !/^[1-9][0-9]{0,15}$/.test(String(values['--max-staged-bytes']))) throw new Error('Invalid staged-bytes cap');
  return values;
}

/** The shared kill switch: `FORCE_CAPABILITIES=co-managed:off` (or a malformed co-managed entry) disables the tool. */
const capabilityForcedOff = async () => {
  const { forcedValue } = await import('@alga-psa/core/capability');
  const state = forcedValue(process.env.FORCE_CAPABILITIES, 'co-managed');
  return state === 'off' || state === 'malformed';
};

async function passphrase(): Promise<string> {
  const fromEnv = process.env.ALGA_PORTABLE_RESTORE_PASSPHRASE;
  delete process.env.ALGA_PORTABLE_RESTORE_PASSPHRASE;
  if (fromEnv) return fromEnv;
  if (!process.stdin.isTTY) {
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
  if (!process.stderr.isTTY) throw new Error('Use an interactive terminal, a protected pipe or the environment variable');
  process.stderr.write('Archive passphrase: ');
  const hidden = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  const rl = createInterface({ input: process.stdin, output: hidden, terminal: true });
  try { return await new Promise<string>((resolvePhrase, reject) => {
    rl.once('line', resolvePhrase);
    rl.once('SIGINT', () => reject(new Error('Cancelled')));
    rl.once('close', () => reject(new Error('Passphrase input closed')));
  }); } finally { rl.close(); hidden.end(); process.stderr.write('\n'); }
}

let phase = 'options';
async function main() {
  const options = args(process.argv.slice(2));
  if (options['--help']) { process.stdout.write(HELP); return; }
  phase = 'environment';
  config({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true });
  if (await capabilityForcedOff()) throw new Error('Capability disabled');
  phase = 'passphrase input';
  let phrase = await passphrase();
  let db: import('knex').Knex | undefined;
  try {
    if (Buffer.byteLength(phrase, 'utf8') < 16 || Buffer.byteLength(phrase, 'utf8') > 1024) throw new Error('Invalid secret length');
    phase = 'restore module loading';
    // Dynamic import (not require): the storage package exports are import-only, so a CJS require of the
    // EE modules fails with ERR_PACKAGE_PATH_NOT_EXPORTED. Loaded only after help/options/kill-switch/input.
    const restore = await import('../../ee/server/src/lib/co-managed/portableWorkspaceRestore');
    const archivePath = resolve(String(options['--archive']));
    if (options['--inspect']) {
      phase = 'archive inspection';
      process.stdout.write(`${JSON.stringify(await restore.inspectPortableWorkspaceArchive(archivePath, phrase), null, 2)}\n`);
      return;
    }
    phase = 'database connection';
    const { getAdminConnection } = await import('@alga-psa/db/admin');
    db = await getAdminConnection();
    phase = 'workspace restore';
    const result = await restore.restorePortableWorkspaceForInstallation(db, { archivePath, passphrase: phrase, resume: !!options['--resume'],
      destinationTenant: String(options['--destination-tenant']), sourceAdministratorUserId: String(options['--administrator-user-id']),
      ...(options['--max-staged-bytes'] ? { maxStagedBytes: Number(options['--max-staged-bytes']) } : {}) });
    process.stdout.write(`${JSON.stringify({ ...result, status: 'restored; the tenant remains suspended pending activation' }, null, 2)}\n`);
  } finally { phrase = ''; await db?.destroy(); }
}

main().catch(() => {
  // Provider/database errors may contain secrets or imported values. Keep the
  // operator failure output deliberately bounded and never print raw errors.
  process.stderr.write(`Portable workspace operation failed during ${phase}. Check options, archive passphrase, destination identity, storage, and database authority.\n`);
  process.exitCode = 1;
});
