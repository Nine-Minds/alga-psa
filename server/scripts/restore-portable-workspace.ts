#!/usr/bin/env node
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Writable } from 'node:stream';
import { createInterface } from 'node:readline';
import { config } from 'dotenv';

const HELP = `Portable workspace restore (installation operator)

Run from server with:
  npm exec -- tsx --tsconfig ../ee/server/tsconfig.json scripts/restore-portable-workspace.ts <options>

  --inspect --archive /absolute/backup.alga
  --restore --archive /absolute/backup.alga --destination-tenant <new UUID> --administrator-user-id <source UUID>
  --passphrase-stdin    Read exact UTF-8 passphrase bytes from a protected pipe (no trailing newline).
  --help               Show this help without connecting to the database.

The default passphrase prompt hides input. Passphrases are never command arguments.
Inspect lists eligible source administrators after authenticating the archive.
Restore requires database owner credentials and a destination UUID you retain for retries.
The imported tenant remains suspended with inactive users pending independent licensing and activation.
`;

function args(argv: string[]) {
  const values: Record<string, string | true> = {};
  const flags = new Set(['--inspect', '--restore', '--passphrase-stdin', '--help']);
  const fields = new Set(['--archive', '--destination-tenant', '--administrator-user-id']);
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key in values) throw new Error('Repeated option');
    if (flags.has(key)) values[key] = true;
    else if (fields.has(key) && argv[i + 1] && !argv[i + 1].startsWith('--')) values[key] = argv[++i];
    else throw new Error('Unknown option or missing value');
  }
  if (values['--help']) return values;
  if (!!values['--inspect'] === !!values['--restore'] || typeof values['--archive'] !== 'string') throw new Error('Choose inspect or restore and supply an archive');
  if (values['--restore'] && (typeof values['--destination-tenant'] !== 'string' || typeof values['--administrator-user-id'] !== 'string')) throw new Error('Restore requires destination and source administrator UUIDs');
  if (values['--inspect'] && (values['--destination-tenant'] || values['--administrator-user-id'])) throw new Error('Inspect does not take restore identities');
  return values;
}

async function passphrase(fromPipe: boolean): Promise<string> {
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
  process.stderr.write('Archive passphrase: ');
  const hidden = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  const rl = createInterface({ input: process.stdin, output: hidden, terminal: true });
  try { return await new Promise<string>((resolve, reject) => {
    rl.once('line', resolve);
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
  phase = 'passphrase input';
  let phrase = await passphrase(!!options['--passphrase-stdin']);
  let db: import('knex').Knex | undefined;
  try {
    if (Buffer.byteLength(phrase, 'utf8') < 16 || Buffer.byteLength(phrase, 'utf8') > 1024) throw new Error('Passphrase must contain 16–1024 UTF-8 bytes');
    // EE sources are CJS under tsx; defer loading them until after help/input.
    phase = 'restore module loading';
    const require = createRequire(import.meta.url);
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
