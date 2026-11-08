import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

// The storage provider is the only seam replaced: it serves bytes by locator, as S3/local would.
const provider = vi.hoisted(() => ({ objects: new Map<string, Buffer>(), reads: [] as string[] }));
vi.mock('@alga-psa/storage/StorageProviderFactory', () => ({ StorageProviderFactory: { createProvider: async () => ({
  getReadStream: async (path: string) => { provider.reads.push(path); const bytes = provider.objects.get(path); if (!bytes) throw new Error('missing'); return Readable.from([bytes]); } }) } }));

vi.mock('../../../../../packages/co-managed/src/localPermission', () => ({
  isCoManagedPermissionProvisioned: async () => true, hasCoManagedLocalPermission: async () => true }));

import { portableFileContributor, validateCoManagedPortableFileRecords, CO_MANAGED_PORTABLE_FILE_COLUMNS }
  from '../../../../../packages/co-managed/src/portableFileExport';
import { createPortableContributorRegistry } from '../../../../../packages/co-managed/src/portableContributorRegistry';
import { CORE_PORTABLE_CONTRIBUTORS } from '../../../../../packages/co-managed/src/portableCoreRegistry';
import { stageCoManagedPortableBlobs } from '../../../../../packages/co-managed/src/portableBlobStaging';
import { collectPortableWorkspace } from '../../../../../packages/co-managed/src/portableWorkspaceGraph';
import { buildCoManagedPortableWorkspaceManifest, validateCoManagedPortableWorkspaceManifest } from '../../../../../packages/co-managed/src/portableWorkspaceManifest';
import { openPortableArchive, sealPortableArchive } from '../../../../../packages/co-managed/src/portableArchive';
import { coManagedPortableNativeFilePath } from '../../../../../packages/co-managed/src/portableNativeFilePath';

const A = '11111111-1111-4111-8111-111111111111', B = '99999999-9999-4999-8999-999999999999', PACKAGE = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333', FILE_A = '44444444-4444-4444-8444-444444444444', FILE_B = '55555555-5555-4555-8555-555555555555';
const context = { packageId: PACKAGE, sourceTenant: A, capturedAt: '2026-01-01T00:00:00.000Z' };
const PASSPHRASE = 'correct horse battery staple';
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const roots: string[] = [];
afterEach(async () => { provider.objects.clear(); provider.reads.length = 0; await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

const record = (id: string, size: number) => ({ file_id: id, original_name: 'a.txt', mime_type: 'text/plain', file_size: size, uploaded_by_id: USER, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' });

/** The files contributor's own staging path, over a table where tenant B's rows exist beside tenant A's. */
async function stageForTenant(tenant: string, table: { tenant: string; id: string; path: string; bytes: Buffer }[]) {
  const mine = table.filter(row => row.tenant === tenant);
  return stageCoManagedPortableBlobs(mine.map(row => ({ id: `file:${row.id}`, path: coManagedPortableNativeFilePath(tenant, row.path), size: row.bytes.length })));
}

describe('portable files contributor', () => {
  it('registers beside the core set with a unique id and a table of its own', () => {
    const ids = CORE_PORTABLE_CONTRIBUTORS.map(c => c.id);
    expect(ids).toContain('files'); expect(new Set(ids).size).toBe(ids.length);
    const registry = createPortableContributorRegistry(CORE_PORTABLE_CONTRIBUTORS);
    expect(registry.owner('external_files')?.id).toBe('files');
    // The documents domain is not touched: no documents table is owned or declared.
    expect(Object.keys(portableFileContributor.columns)).toEqual(['external_files']);
  });
  it('projects no storage locator, provider metadata or secret column', () => {
    expect(CO_MANAGED_PORTABLE_FILE_COLUMNS.external_files).not.toContain('storage_path');
    expect(CO_MANAGED_PORTABLE_FILE_COLUMNS.external_files).not.toContain('metadata');
    expect(CO_MANAGED_PORTABLE_FILE_COLUMNS.external_files).not.toContain('tenant');
  });
  it('validate accepts this workspace and rejects a foreign-tenant uploader, bad sizes and duplicate files', () => {
    const users = [{ user_id: USER }];
    const ok = { external_files: [record(FILE_A, 3)] };
    expect(() => validateCoManagedPortableFileRecords(ok, { users })).not.toThrow();
    expect(() => portableFileContributor.validate(ok, { ...ok, users })).not.toThrow();
    expect(() => portableFileContributor.validate({ external_files: [{ ...record(FILE_B, 3), uploaded_by_id: randomUUID() }] }, { users, external_files: [] })).toThrow();
    expect(() => portableFileContributor.validate(ok, ok)).toThrow(); // workspace without users
    expect(() => validateCoManagedPortableFileRecords({ external_files: [record(FILE_A, -1)] })).toThrow();
    expect(() => validateCoManagedPortableFileRecords({ external_files: [record(FILE_A, 1.5)] })).toThrow();
    expect(() => validateCoManagedPortableFileRecords({ external_files: [record(FILE_A, 1), record(FILE_A, 1)] })).toThrow();
    expect(() => validateCoManagedPortableFileRecords({ external_files: [{ ...record(FILE_A, 1), tenant: B }] })).toThrow();
  });
  it('stages bytes at a hash and size that a sealed archive carries into manifest.blobs[] and reopens identically', async () => {
    const bytes = Buffer.from('tenant A file contents'), path = `${A}/docs/a.txt`;
    provider.objects.set(path, bytes);
    const lease = await stageCoManagedPortableBlobs([{ id: `file:${FILE_A}`, path: coManagedPortableNativeFilePath(A, path), size: bytes.length }]);
    const root = await mkdtemp(join(tmpdir(), 'l7b1-files-')); roots.push(root);
    try {
      const contributor = { ...portableFileContributor, validate: () => {}, retain: async () => ({ records: { external_files: [record(FILE_A, bytes.length)] } }),
        export: async () => ({ records: { external_files: [record(FILE_A, bytes.length)] }, files: lease }) };
      const registry = createPortableContributorRegistry([contributor]);
      const collected = await collectPortableWorkspace(registry, { db: {} as any, actor: { kind: 'session', tenant: A, userId: USER, sessionId: 's' } as any, packageId: PACKAGE, snapshot: { capturedAt: context.capturedAt } });
      const manifest = buildCoManagedPortableWorkspaceManifest({ context, collected, registry });
      expect(manifest.blobs).toEqual([{ id: `file:${FILE_A}`, size: bytes.length, sha256: sha(bytes) }]);
      const sealed = await sealPortableArchive({ context: { packageId: PACKAGE, sourceTenant: A }, manifest: { ...manifest }, files: collected.files, stagingRoot: root }, PASSPHRASE);
      let opened: Awaited<ReturnType<typeof openPortableArchive>> | undefined;
      try {
        opened = await openPortableArchive(sealed.path, PASSPHRASE, { packageId: PACKAGE, sourceTenant: A }, root);
        const reopened = validateCoManagedPortableWorkspaceManifest(opened.manifest, context, opened.files, registry);
        expect(reopened.blobs).toEqual(manifest.blobs);
        expect(opened.files).toHaveLength(1);
        expect(opened.files[0]).toMatchObject({ id: `file:${FILE_A}`, size: bytes.length, sha256: sha(bytes) });
        expect((await readFile(opened.files[0].path)).equals(bytes)).toBe(true);
      } finally { await opened?.dispose(); await sealed.dispose(); }
    } finally { await collected_dispose(lease); }
  });
  it("tenant B's files never reach tenant A's staging, and another tenant's locator is refused before any read", async () => {
    const table = [{ tenant: A, id: FILE_A, path: `${A}/a.bin`, bytes: Buffer.from('aaa') }, { tenant: B, id: FILE_B, path: `${B}/b.bin`, bytes: Buffer.from('bbbb') }];
    for (const row of table) provider.objects.set(row.path, row.bytes);
    const lease = await stageForTenant(A, table);
    try {
      expect(lease.files.map(file => file.id)).toEqual([`file:${FILE_A}`]);
      expect(provider.reads).toEqual([`${A}/a.bin`]);
    } finally { await lease.dispose(); }
    provider.reads.length = 0;
    // A row of tenant A whose locator points into tenant B's namespace is refused outright.
    await expect(stageForTenant(A, [{ tenant: A, id: FILE_B, path: `${B}/b.bin`, bytes: Buffer.from('bbbb') }])).rejects.toThrow();
    expect(provider.reads).toEqual([]);
  });
  it('rejects blob names that are unsafe, uppercased or duplicated, and sizes or hashes that drift', async () => {
    provider.objects.set(`${A}/a.bin`, Buffer.from('aaa'));
    const ok = { id: `file:${FILE_A}`, path: `${A}/a.bin`, size: 3 };
    for (const bad of [{ ...ok, id: 'file:../../x' }, { ...ok, id: 'file:not-a-uuid' }, { ...ok, id: `File:${FILE_A}:x` }]) await expect(stageCoManagedPortableBlobs([bad])).rejects.toThrow('Invalid portable source blob');
    await expect(stageCoManagedPortableBlobs([ok, ok])).rejects.toThrow('Invalid portable source blob');
    await expect(stageCoManagedPortableBlobs([{ ...ok, size: 2 }])).rejects.toThrow('could not be staged');
    await expect(stageCoManagedPortableBlobs([{ ...ok, size: 4 }])).rejects.toThrow('could not be staged');
    await expect(stageCoManagedPortableBlobs([{ ...ok, sha256: '0'.repeat(64) }])).rejects.toThrow('could not be staged');
  });
});
const collected_dispose = (lease: { dispose(): Promise<void> }) => lease.dispose();
