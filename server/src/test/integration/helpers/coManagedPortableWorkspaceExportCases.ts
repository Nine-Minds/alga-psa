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

  it('portable export browser handler streams after releasing database locks and rejects revoked or foreign requests', async () => workspace(async f => {
    const auth = await import('@alga-psa/auth'), database = await import('@alga-psa/db');
    const session = vi.spyOn(auth, 'getSession').mockResolvedValue({ session_id: f.customerPrincipal.sessionId,
      user: { id: f.customerPrincipal.userId, tenant: f.customerPrincipal.tenant, user_type: 'internal' } } as any);
    const override = vi.spyOn(auth, 'getApiKeyUserOverride').mockReturnValue(undefined);
    const connection = vi.spyOn(database, 'getConnection').mockResolvedValue(getDb());
    const oldOrigin = process.env.NEXTAUTH_URL; process.env.NEXTAUTH_URL = 'https://customer.example.test';
    const { handleCoManagedPortableExport } = await import('../../../../../ee/server/src/lib/co-managed/portableExportHandler');
    const request = (origin = 'https://customer.example.test', body = new URLSearchParams({ passphrase: f.passphrase }).toString()) => new Request('https://customer.example.test/api/co-management/export',
      { method: 'POST', headers: { origin, 'content-type': 'application/x-www-form-urlencoded' }, body });
    try {
      expect((await handleCoManagedPortableExport(request('https://foreign.example.test'))).status).toBe(403);
      expect((await handleCoManagedPortableExport(request(undefined, 'passphrase=short'))).status).toBe(400);
      expect((await handleCoManagedPortableExport(request(undefined, 'passphrase=' + 'x'.repeat(5000)))).status).toBe(400);
      expect(f.provider).not.toHaveBeenCalled();
      const response = await handleCoManagedPortableExport(request());
      expect(response.status).toBe(200); expect(response.headers.get('content-disposition')).toMatch(/alga-workspace-.*\.alga-backup/);
      expect(response.headers.get('cache-control')).toContain('no-store');
      // The response owns an open encrypted descriptor; no source lock survives
      // network delivery admission, even before the browser requests a byte.
      await getDb().transaction(async trx => {
        await trx.raw("SET LOCAL lock_timeout = '100ms'");
        await trx('tickets').where({ tenant: f.actor.tenant, ticket_id: f.resource.id }).update({ title: 'Updated after download admission' });
      });
      expect(await f.fs.readdir(f.root)).toEqual([]);
      const bytes = Buffer.from(await response.arrayBuffer()); expect(bytes.length).toBe(Number(response.headers.get('content-length')));
      const path = `${f.root}/browser-download.alga`; await f.fs.writeFile(path, bytes);
      const { openPortableArchive } = await import('../../../../../packages/co-managed/src/portableArchive');
      const opened = await openPortableArchive(path, f.passphrase);
      try { expect(opened.manifest.sections.work.records.tickets.some((row: any) => row.title === 'Updated after download admission')).toBe(false); }
      finally { await opened.dispose(); await f.fs.unlink(path); }
      await f.customer.table('sessions').where('session_id', f.customerPrincipal.sessionId).update({ revoked_at: getDb().fn.now() });
      expect((await handleCoManagedPortableExport(request())).status).toBe(403);
      expect(await f.fs.readdir(f.root)).toEqual([]);
    } finally {
      session.mockRestore(); override.mockRestore(); connection.mockRestore();
      if (oldOrigin === undefined) delete process.env.NEXTAUTH_URL; else process.env.NEXTAUTH_URL = oldOrigin;
    }
  }));

  it('portable workspace restore inserts actual files records and usable vault into a new suspended tenant atomically', async () => workspace(async f => {
    const { escalateCoManagedTicket, handBackCoManagedTicket } = await import('../../../../../packages/co-managed/src/ticketHandoffs');
    await escalateCoManagedTicket(getDb(), f.customerPrincipal, f.resource, { operationId: randomUUID(), expectedRevision: 0, note: 'Retain this historical escalation' });
    await handBackCoManagedTicket(getDb(), f.principal, f.resource, { operationId: randomUUID(), expectedRevision: 1, note: 'Retain this historical MSP handback' });
    const contactId = randomUUID(), threadId = randomUUID(), commentId = randomUUID();
    const ticket = await f.customer.table('tickets').where('ticket_id', f.resource.id).first();
    await f.customer.table('contacts').insert({ tenant: f.actor.tenant, contact_name_id: contactId, full_name: 'Portable contact', client_id: ticket.client_id });
    await f.customer.table('contact_phone_numbers').insert({ tenant: f.actor.tenant, contact_phone_number_id: randomUUID(), contact_name_id: contactId,
      phone_number: '+1 (206) 555-0142', canonical_type: 'work' });
    await f.customer.table('comment_threads').insert({ tenant: f.actor.tenant, thread_id: threadId, ticket_id: f.resource.id, root_comment_id: commentId, is_internal: false, created_by: f.actor.userId });
    await f.customer.table('comments').insert({ tenant: f.actor.tenant, comment_id: commentId, thread_id: threadId, ticket_id: f.resource.id,
      user_id: f.actor.userId, note: 'Restored canonical root', is_internal: false, is_resolution: false, publish_state: 'published' });
    const handle = await f.prepare(), archivePath = `${f.root}/restore-source.alga`;
    await handle.consume(async (artifact: any) => f.fs.copyFile(artifact.path, archivePath));
    const { openPortableArchive } = await import('../../../../../packages/co-managed/src/portableArchive');
    const { prepareCoManagedPortableWorkspaceRecords } = await import('../../../../../packages/co-managed/src/portableWorkspaceRestoreRecords');
    const { prepareCoManagedPortableWorkspaceFiles, stageCoManagedPortableWorkspaceFiles } = await import('../../../../../packages/co-managed/src/portableWorkspaceRestoreFiles');
    const { prepareCoManagedPortableWorkspaceVault } = await import('../../../../../ee/server/src/lib/co-managed/portableWorkspaceRestoreVault');
    const { resolveCoManagedPortableDestinationCatalogs, insertCoManagedPortableWorkspaceDatabase } = await import('../../../../../ee/server/src/lib/co-managed/portableWorkspaceRestoreDatabase');
    const opened = await openPortableArchive(archivePath, f.passphrase), objects = new Map<string, Buffer>();
    let lease: any;
    try {
      const sections = Object.fromEntries(Object.entries(opened.manifest.sections).map(([name, component]: any) => [name, component.records]));
      const catalog = await getDb().transaction(trx => resolveCoManagedPortableDestinationCatalogs(trx, sections as any, f.actor.tenant));
      const destinationTenant = randomUUID();
      const records = prepareCoManagedPortableWorkspaceRecords({ sourceTenant: f.actor.tenant, destinationTenant, sections: sections as any, destinationCatalogMappings: catalog });
      const files = prepareCoManagedPortableWorkspaceFiles({ manifest: opened.manifest, files: opened.files, preparedRecords: records,
        importedByUserId: String(records.records.users[0].user_id) });
      const vault = await prepareCoManagedPortableWorkspaceVault({ manifest: opened.manifest, restoreRecords: records, passphrase: f.passphrase }, { reservedUuids: files.allocatedIds });
      lease = await stageCoManagedPortableWorkspaceFiles(files, {
        getCapabilities: () => ({ supportsStreaming: true, maxFileSize: 1024 ** 3 }),
        upload: async (stream: any, path: string, options: any) => { const chunks = []; for await (const chunk of stream) chunks.push(Buffer.from(chunk));
          const bytes = Buffer.concat(chunks); objects.set(path, bytes); return { path, size: bytes.length, mime_type: options.mime_type }; },
        delete: async (path: string) => { objects.delete(path); },
      } as any);
      const input = { preparedRecords: files, externalFiles: lease.externalFiles, vault };
      await expect(getDb().transaction(async trx => {
        await insertCoManagedPortableWorkspaceDatabase(trx, input); throw new Error('Caller rollback');
      })).rejects.toThrow('Caller rollback');
      expect(await getDb()('tenants').where('tenant', destinationTenant).first()).toBeUndefined();
      await getDb().raw(getDb().raw('ALTER TABLE credentials ADD CONSTRAINT portable_restore_fault CHECK (tenant <> ?::uuid) NOT VALID', [destinationTenant]).toQuery());
      try {
        await getDb().transaction(async trx => {
          await expect(insertCoManagedPortableWorkspaceDatabase(trx, input)).rejects.toThrow('portable_restore_fault');
          // Caller catches the error and commits its outer transaction; the
          // restore's savepoint must still remove every partially inserted row.
        });
      } finally { await getDb().raw('ALTER TABLE credentials DROP CONSTRAINT portable_restore_fault'); }
      expect(await getDb()('tenants').where('tenant', destinationTenant).first()).toBeUndefined();
      const result = await getDb().transaction(trx => insertCoManagedPortableWorkspaceDatabase(trx, input));
      lease.release();
      expect(result.suspended).toBe(true);
      const own = (await import('@alga-psa/db')).tenantDb(getDb(), destinationTenant);
      expect(await own.table('tenants').first()).toMatchObject({ product_code: 'psa', suspended_reason: 'portable_restore_pending_activation' });
      expect((await own.table('users')).every((user: any) => user.is_inactive && user.hashed_password === '!portable-restore-disabled')).toBe(true);
      expect(await own.table('co_management_relationships')).toEqual([]); expect(await own.table('sessions')).toEqual([]);
      expect(await own.table('co_management_ticket_handoffs')).toEqual([]);
      const history = await own.table('ticket_audit_logs').where('event_type', 'TICKET_HANDOFF_RESTORED');
      expect(history).toHaveLength(2); expect(history.map((row: any) => row.details.portable_handoff.note)).toContain('Retain this historical MSP handback');
      const restoredThread = await own.table('comment_threads').first(), restoredComment = await own.table('comments').first();
      expect(restoredThread.root_comment_id).toBe(restoredComment.comment_id); expect(restoredComment.thread_id).toBe(restoredThread.thread_id);
      expect((await own.table('contact_phone_numbers').first()).normalized_phone_number).toBe((await f.customer.table('contact_phone_numbers').first()).normalized_phone_number);
      const suspension = await import('@alga-psa/db');
      expect(await suspension.resumeTenant(getDb(), destinationTenant, 'tenant_cancelled')).toBe(false);
      expect(await suspension.isTenantSuspended(getDb(), destinationTenant)).toBe(true);
      const migration = (await import('../../../../../server/migrations/20260908191851_add_portable_restore_suspension.cjs')).default;
      await expect(migration.down(getDb())).rejects.toThrow('awaits activation');
      expect((await own.table('tickets')).map((row: any) => row.title)).toEqual(records.records.tickets.map(row => row.title));
      const credential = await own.table('credentials').first();
      expect(await f.encryption.decryptCredentialValue(credential.password_ciphertext, credential.encryption_scheme)).toBe('customer recovery password');
      const file = await own.table('external_files').first(); expect(objects.get(file.storage_path)?.equals(f.bytes)).toBe(true);
      await expect(getDb().transaction(trx => insertCoManagedPortableWorkspaceDatabase(trx, input))).rejects.toThrow('already exists');
    } finally { await lease?.dispose(); await opened.dispose(); }
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
