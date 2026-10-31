import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { openPortableArchive, sealPortableArchive } from '../../../../../packages/co-managed/src/portableArchive';
import { prepareCoManagedPortableWorkspaceFiles, stageCoManagedPortableWorkspaceFiles, PORTABLE_RESTORE_DEFAULT_STAGED_BYTES_CAP,
  type PortableRestoreBlobBinder } from '../../../../../packages/co-managed/src/portableWorkspaceRestoreFiles';
import { fixtureManifest, prepare, ADMIN, PACKAGE, SOURCE, TARGET } from './portableRestoreFixtures';

const PASSPHRASE = 'correct horse battery staple';
const BLOB = `attachment:00000000-0000-4000-8000-0000000000aa`;
const bytes = Buffer.from('Authenticated customer bytes');
const binder: PortableRestoreBlobBinder = { kind: 'attachment', bind: () => ({ name: 'customer.bin', mimeType: 'application/octet-stream' }) };
const archiveContext = (c: { packageId: string; sourceTenant: string }) => ({ packageId: c.packageId, sourceTenant: c.sourceTenant });
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

/** In-memory storage provider recording what was written and deleted. */
function provider() {
  const objects = new Map<string, Buffer>();
  return { objects,
    getCapabilities: () => ({ supportsStreaming: true }) as never,
    upload: async (stream: Readable, path: string, options: { mime_type: string; size: number }) => {
      const chunks: Buffer[] = []; for await (const chunk of stream) chunks.push(Buffer.from(chunk));
      const body = Buffer.concat(chunks); objects.set(path, body);
      return { path, size: body.length, mime_type: options.mime_type } as never;
    },
    delete: async (path: string) => { objects.delete(path); } };
}

async function archive() {
  const root = await mkdtemp(join(tmpdir(), 'alga-l7b2-')); roots.push(root);
  await mkdir(join(root, 'src'));
  const path = join(root, 'src', 'blob.bin'); await writeFile(path, bytes);
  const blob = { id: BLOB, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), path };
  const { manifest, context, files } = await fixtureManifest(() => {}, [blob]);
  const sealed = await sealPortableArchive({ context: archiveContext(context), manifest: manifest as never, files, stagingRoot: root }, PASSPHRASE);
  const opened = await openPortableArchive(sealed.path, PASSPHRASE, archiveContext(context), root);
  return { manifest, opened, dispose: async () => { await opened.dispose?.(); await sealed.dispose(); } };
}

describe('portable restore bytes: prepare, stage, verify', () => {
  it('stages hash-verified bytes from an opened archive under a unique per-attempt key and can clean them up', async () => {
    const { manifest, opened, dispose } = await archive();
    try {
      const records = prepare(manifest);
      const files = prepareCoManagedPortableWorkspaceFiles({ manifest, files: opened.files, preparedRecords: records, importedByUserId: records.records.users[0].user_id as string, binders: [binder] });
      expect(files.externalFiles).toHaveLength(1);
      expect(files.externalFiles[0]).toMatchObject({ tenant: TARGET, original_name: 'customer.bin', file_size: bytes.length });
      const storage = provider();
      const lease = await stageCoManagedPortableWorkspaceFiles(files, storage);
      expect([...storage.objects.values()]).toEqual([bytes]);
      expect([...storage.objects.keys()][0]).toMatch(new RegExp(`^${TARGET}/portable-restores/`));
      expect(lease.externalFiles[0].storage_path).toBe([...storage.objects.keys()][0]);
      await lease.dispose();
      expect(storage.objects.size).toBe(0);
    } finally { await dispose(); }
  });
  it('fails closed when the blob kind has no binder', async () => {
    const { manifest, opened, dispose } = await archive();
    try {
      const records = prepare(manifest);
      expect(() => prepareCoManagedPortableWorkspaceFiles({ manifest, files: opened.files, preparedRecords: records, importedByUserId: records.records.users[0].user_id as string })).toThrow(/no file binder/);
    } finally { await dispose(); }
  });
  it('enforces the staged-bytes cap before any provider write', async () => {
    const { manifest, opened, dispose } = await archive();
    try {
      const records = prepare(manifest);
      const request = { manifest, files: opened.files, preparedRecords: records, importedByUserId: records.records.users[0].user_id as string, binders: [binder] };
      expect(() => prepareCoManagedPortableWorkspaceFiles({ ...request, maxStagedBytes: bytes.length - 1 })).toThrow(/staged-bytes cap/);
      expect(() => prepareCoManagedPortableWorkspaceFiles({ ...request, maxStagedBytes: bytes.length })).not.toThrow();
      const staged = prepareCoManagedPortableWorkspaceFiles(request);
      const storage = provider();
      await expect(stageCoManagedPortableWorkspaceFiles({ ...staged, maxStagedBytes: bytes.length - 1 }, storage)).rejects.toThrow();
      expect(storage.objects.size).toBe(0);
    } finally { await dispose(); }
  });
  it('documents a 16 GiB default staged-bytes cap', () => {
    expect(PORTABLE_RESTORE_DEFAULT_STAGED_BYTES_CAP).toBe(16 * 1024 ** 3);
  });
  it('rejects a wrong passphrase when opening the archive (fails closed, nothing staged)', async () => {
    const { manifest, opened, dispose } = await archive(); void manifest; void opened;
    await dispose();
    const root = await mkdtemp(join(tmpdir(), 'alga-l7b2-')); roots.push(root);
    const { manifest: m, context, files } = await fixtureManifest();
    const sealed = await sealPortableArchive({ context: archiveContext(context), manifest: m as never, files, stagingRoot: root }, PASSPHRASE);
    try { await expect(openPortableArchive(sealed.path, 'not the right passphrase', archiveContext(context), root)).rejects.toThrow(); } finally { await sealed.dispose(); }
    void ADMIN; void PACKAGE; void SOURCE;
  });
});
