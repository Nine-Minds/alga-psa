import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import type { Knex } from 'knex';

/** The enclosing suite supplies real tracked users, relationship, credential
 * rows/provider and its schema-clone connection. File bytes are streamed through
 * the actual staging/archive code into an isolated temporary directory. */
export function registerCoManagedPortableWorkspaceExportTests(getDb: () => Knex,
  withVaultFixture: (work: (fixture: any) => Promise<void>) => Promise<void>, storage: { getReadStream: any }) {
  async function workspace(work: (fixture: any) => Promise<void>) {
    await withVaultFixture(async f => {
      const fs = await import('node:fs/promises'), os = await import('node:os'), path = await import('node:path');
      const { Readable } = await import('node:stream');
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'portable-workspace-test-')), previousTmp = process.env.TMPDIR;
      process.env.TMPDIR = root;
      const fileId = randomUUID(), documentId = randomUUID(), bytes = Buffer.from('Customer file in coherent portable workspace');
      const storagePath = `/${f.actor.tenant}/workspace-test.bin`;
      await f.customer.table('external_files').insert({ tenant: f.actor.tenant, file_id: fileId, file_name: 'workspace.bin', original_name: 'workspace.bin',
        mime_type: 'application/octet-stream', file_size: bytes.length, storage_path: storagePath, uploaded_by_id: f.actor.userId });
      await f.customer.table('documents').insert({ tenant: f.actor.tenant, document_id: documentId, document_name: 'Customer workspace file',
        created_by: f.actor.userId, user_id: f.actor.userId, file_id: fileId, file_size: bytes.length, mime_type: 'application/octet-stream' });
      await f.customer.table('document_associations').insert({ tenant: f.actor.tenant, association_id: randomUUID(), document_id: documentId, entity_id: f.resource.id, entity_type: 'ticket' });
      const stream = async (source: string) => { if (source !== storagePath) throw new Error('Unexpected object'); return Readable.from([bytes]); };
      storage.getReadStream.mockReset().mockImplementation(stream);
      const module = await import('../../../../../ee/server/src/lib/co-managed/portableWorkspaceExport');
      const passphrase = 'Customer-held workspace export recovery phrase';
      try { await work({ ...f, ...module, fs, root, fileId, documentId, bytes, storagePath, stream, passphrase,
        prepare: () => module.prepareCoManagedPortableWorkspaceExport(getDb(), f.customerPrincipal, passphrase) }); }
      finally { storage.getReadStream.mockReset(); if (previousTmp === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = previousTmp; await fs.rm(root, { recursive: true, force: true }); }
    });
  }

  it('portable workspace coordinator seals all sections at one cutoff and delivers under fresh native locks without provider work', async () => workspace(async f => {
    const handle = await f.prepare(), db = getDb();
    const providerReads = storage.getReadStream.mock.calls.length, vaultReads = f.provider.mock.calls.length;
    let archiveBytes: Buffer;
    try {
      expect(handle.path).toBeUndefined();
      archiveBytes = await handle.consume(async (archive: any) => {
        await expect(db.transaction(async trx => {
          await trx.raw("SET LOCAL lock_timeout = '50ms'");
          await trx('tickets').where({ tenant: f.actor.tenant, ticket_id: f.resource.id }).update({ title: 'Must stay locked' });
        })).rejects.toMatchObject({ code: '55P03' });
        await expect(db.transaction(async trx => {
          await trx.raw("SET LOCAL lock_timeout = '50ms'");
          await trx('documents').where({ tenant: f.actor.tenant, document_id: f.documentId }).update({ document_name: 'Must stay locked' });
        })).rejects.toMatchObject({ code: '55P03' });
        return f.fs.readFile(archive.path);
      });
      expect(storage.getReadStream).toHaveBeenCalledTimes(providerReads); expect(f.provider).toHaveBeenCalledTimes(vaultReads);
      expect(await f.fs.readdir(f.root)).toEqual([]);
      await expect(handle.consume(vi.fn())).rejects.toMatchObject({ code: 'CO_MANAGED_SHARED_WORK_FORBIDDEN' });
    } finally { await handle.dispose(); }
    const archivedPath = `${f.root}/download.alga`; await f.fs.writeFile(archivedPath, archiveBytes!);
    const { openPortableArchive } = await import('../../../../../packages/co-managed/src/portableArchive');
    const opened = await openPortableArchive(archivedPath, f.passphrase, { packageId: handle.packageId, sourceTenant: f.actor.tenant });
    try {
      const { validateCoManagedPortableWorkspaceManifest } = await import('../../../../../packages/co-managed/src/portableWorkspaceManifest');
      const manifest = validateCoManagedPortableWorkspaceManifest(opened.manifest, opened.context, opened.files);
      expect(Object.keys(manifest.sections).sort()).toEqual(['assets', 'core', 'documents', 'engagement', 'operational', 'work', 'workflows']);
      expect(manifest.context.capturedAt).toBe(handle.capturedAt);
      for (const [name, section] of Object.entries(manifest.sections)) if (name !== 'documents') expect(section.capturedAt).toBe(handle.capturedAt);
      expect((await f.fs.readFile(opened.files.find(file => file.id === `file:${f.fileId}`)!.path)).equals(f.bytes)).toBe(true);
      expect(JSON.stringify(manifest)).not.toContain(f.mspCredentialId);
      const { restorePortableCredentialVault } = await import('../../../../../ee/server/src/lib/credentials/portable');
      const restored = await restorePortableCredentialVault(manifest.credentialVault.vault, opened.context, [f.credentialId], f.passphrase);
      expect(await f.encryption.decryptCredentialValue(restored[0].passwordCiphertext, restored[0].scheme)).toBe('customer recovery password');
    } finally { await opened.dispose(); }
  }));

  it('portable workspace coordinator rejects source changes after staging and revoked sessions before any delivery callback', async () => workspace(async f => {
    const changed = await f.prepare(), callback = vi.fn();
    await f.customer.table('tickets').where('ticket_id', f.resource.id).update({ title: 'Changed after archive preparation' });
    await expect(changed.consume(callback)).rejects.toMatchObject({ code: 'CO_MANAGED_SHARED_WORK_FORBIDDEN' });
    expect(callback).not.toHaveBeenCalled(); expect(await f.fs.readdir(f.root)).toEqual([]);
    const revoked = await f.prepare();
    await f.customer.table('sessions').where('session_id', f.customerPrincipal.sessionId).update({ revoked_at: getDb().fn.now() });
    await expect(revoked.consume(callback)).rejects.toMatchObject({ code: 'CO_MANAGED_SHARED_WORK_FORBIDDEN' });
    expect(callback).not.toHaveBeenCalled(); expect(await f.fs.readdir(f.root)).toEqual([]);
  }));

  it('portable workspace coordinator removes all staged files after a later credential provider failure and disposes abandoned packages', async () => workspace(async f => {
    const provider = f.provider.getMockImplementation();
    f.provider.mockImplementation(async () => { throw new Error('Synthetic credential provider failure'); });
    await expect(f.prepare()).rejects.toThrow();
    expect(await f.fs.readdir(f.root)).toEqual([]);
    f.provider.mockImplementation(provider);
    const abandoned = await f.prepare(); await abandoned.dispose();
    expect(await f.fs.readdir(f.root)).toEqual([]);
    await expect(abandoned.consume(vi.fn())).rejects.toMatchObject({ code: 'CO_MANAGED_SHARED_WORK_FORBIDDEN' });
  }));
}
