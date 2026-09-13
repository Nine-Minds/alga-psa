import { mkdtemp, writeFile, rm, unlink, symlink, truncate } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { acquirePortableDownload } from '../../../../../packages/co-managed/src/portableDownload';

async function fixture(work: (f: any) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'portable-download-')), path = join(root, 'sealed'), bytes = Buffer.alloc(192 * 1024 + 17, 0x72);
  await writeFile(path, bytes, { mode: 0o600 });
  const artifact = { path, packageId: randomUUID(), sourceTenant: randomUUID(), capturedAt: new Date().toISOString(), size: bytes.length, sha256: 'a'.repeat(64) };
  try { await work({ root, path, bytes, artifact }); } finally { await rm(root, { recursive: true, force: true }); }
}
it('streams a descriptor only after admission completes, after its private path has been unlinked', () => fixture(async f => {
  let committed = false;
  const download = await acquirePortableDownload(async consume => { const value = await consume(f.artifact); await unlink(f.path); committed = true; return value; });
  expect(committed).toBe(true); expect((download as any).path).toBeUndefined();
  const reader = download.stream.getReader(), chunks = [];
  while (true) { const next = await reader.read(); if (next.done) break; expect(next.value.length).toBeLessThanOrEqual(65536); chunks.push(next.value); }
  expect(Buffer.concat(chunks).equals(f.bytes)).toBe(true); await download.dispose();
}));
it('cleans acquired descriptors on failed final admission and rejects symlinks or changed sizes', () => fixture(async f => {
  await expect(acquirePortableDownload(async consume => { await consume(f.artifact); await unlink(f.path); throw new Error('Revoked'); })).rejects.toThrow('Revoked');
  const source = join(f.root, 'source'); await writeFile(source, f.bytes); await symlink(source, f.path);
  await expect(acquirePortableDownload(consume => consume(f.artifact))).rejects.toThrow();
  await unlink(f.path); await writeFile(f.path, 'Short');
  await expect(acquirePortableDownload(consume => consume(f.artifact))).rejects.toThrow('unavailable');
}));
it('closes cancelled streams and reports truncation instead of a successful partial download', () => fixture(async f => {
  const abort = new AbortController(); const download = await acquirePortableDownload(consume => consume(f.artifact), abort.signal);
  const reader = download.stream.getReader(); await reader.read(); abort.abort(); await expect(reader.read()).rejects.toThrow('cancelled'); await download.dispose();
  const changed = await acquirePortableDownload(consume => consume(f.artifact)); await truncate(f.path, 0);
  await expect(changed.stream.getReader().read()).rejects.toThrow('failed'); await changed.dispose();
  const cancelled = await acquirePortableDownload(consume => consume(f.artifact)).catch(() => null); expect(cancelled).toBeNull();
}));
