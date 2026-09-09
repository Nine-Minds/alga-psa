import { randomUUID } from 'node:crypto';
import { constants, type Dir } from 'node:fs';
import { chmod, lstat, mkdtemp, open, opendir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

// Public transfers stop within 30 minutes. The longer local lease also permits
// an encrypted prepared download to await admission, but never indefinitely.
export const PORTABLE_TEMPORARY_LIFETIME_MS = 2 * 60 * 60 * 1000;
const MARKER = '.alga-portable-lease.json';
const NAME = /^alga-portable-(archive|blobs|remote-meetings|restore)-[0-9a-f-]{36}-[a-zA-Z0-9]{6}$/;
type Kind = 'archive' | 'blobs' | 'remote-meetings' | 'restore';

/** The marker is durable before any caller can write customer bytes. No tenant
 * data or secrets belong in it. Unmarked legacy directories are not reclaimed. */
export async function createPortableTemporaryDirectory(kind: Kind, root = tmpdir()) {
  if (!['archive', 'blobs', 'remote-meetings', 'restore'].includes(kind)) throw new Error('Invalid portable staging kind');
  const directory = await mkdtemp(join(root, `alga-portable-${kind}-${randomUUID()}-`));
  const dispose = () => rm(directory, { recursive: true, force: true });
  try {
    await chmod(directory, 0o700);
    const stat = await lstat(directory), createdAt = Date.now(), expiresAt = createdAt + PORTABLE_TEMPORARY_LIFETIME_MS;
    const marker = await open(join(directory, MARKER), 'wx', 0o600);
    try {
      await marker.writeFile(JSON.stringify({ version: 1, name: basename(directory), device: stat.dev, inode: stat.ino,
        uid: stat.uid, createdAt, expiresAt }));
      await marker.sync();
    } finally { await marker.close(); }
    const handle = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { await handle.sync(); } finally { await handle.close(); }
    return { directory, expiresAt, dispose, assertActive() {
      if (Date.now() >= expiresAt) throw new Error('Portable staging lease has expired');
    } };
  } catch (error) { await dispose(); throw error; }
}

async function removeExpired(directory: string, now: number): Promise<boolean> {
  const stat = await lstat(directory);
  if (!stat.isDirectory() || (stat.mode & 0o777) !== 0o700 || typeof process.getuid !== 'function' || stat.uid !== process.getuid()) return false;
  const file = await open(join(directory, MARKER), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const marker = await file.stat();
    if (!marker.isFile() || marker.uid !== stat.uid || (marker.mode & 0o777) !== 0o600 || marker.size > 4096) return false;
    const bytes = Buffer.alloc(4097), { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
    if (bytesRead !== marker.size || bytesRead > 4096) return false;
    const lease = JSON.parse(bytes.subarray(0, bytesRead).toString('utf8'));
    if (!lease || lease.version !== 1 || lease.name !== basename(directory) || lease.device !== stat.dev ||
        lease.inode !== stat.ino || lease.uid !== stat.uid || !Number.isSafeInteger(lease.createdAt) ||
        !Number.isSafeInteger(lease.expiresAt) || lease.expiresAt !== lease.createdAt + PORTABLE_TEMPORARY_LIFETIME_MS ||
        now < lease.expiresAt) return false;
    const current = await lstat(directory);
    if (!current.isDirectory() || current.dev !== stat.dev || current.ino !== stat.ino || current.uid !== stat.uid) return false;
    await rm(directory, { recursive: true, force: true });
    return true;
  } finally { await file.close(); }
}

/** One cursor per application process bounds memory and scan work without
 * repeatedly inspecting only the first entries of a busy shared temp directory.
 * Concurrent calls share a sweep; another process removing a lease is harmless. */
export function createPortableTemporarySweeper(root = tmpdir()) {
  let cursor: Dir | undefined, pending: Promise<{ scanned: number; removed: number; failed: number }> | undefined;
  return {
    sweep(limit = 1000) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_000) throw new Error('Invalid portable staging scan limit');
      if (pending) return pending;
      const run = async () => {
        let scanned = 0, removed = 0, failed = 0;
        cursor ??= await opendir(root);
        while (scanned < limit) {
          const entry = await cursor.read();
          if (!entry) { await cursor.close(); cursor = undefined; break; }
          scanned++;
          if (!entry.isDirectory() || !NAME.test(entry.name)) continue;
          try { if (await removeExpired(join(root, entry.name), Date.now())) removed++; }
          catch (error) {
            // Invalid markers and links cannot authorize deletion. A missing
            // directory/marker also occurs during ordinary disposal.
            if (!(error instanceof SyntaxError) && !['ENOENT', 'ELOOP'].includes((error as NodeJS.ErrnoException).code ?? '')) failed++;
          }
        }
        return { scanned, removed, failed };
      };
      pending = run().catch(async error => {
        await cursor?.close().catch(() => {}); cursor = undefined; throw error;
      }).finally(() => { pending = undefined; });
      return pending;
    },
    async close() { await pending; if (cursor) { await cursor.close(); cursor = undefined; } },
  };
}
