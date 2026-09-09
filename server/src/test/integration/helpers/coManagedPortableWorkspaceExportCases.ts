import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { seedPortableWorkflowTaskHistory } from './coManagedPortableWorkflowCases';

/** The enclosing suite supplies real tracked users, relationship, credential
 * rows/provider and its schema-clone connection. File bytes are streamed through
 * the actual staging/archive code into an isolated temporary directory. */
export function registerCoManagedPortableWorkspaceExportTests(getDb: () => Knex,
  withVaultFixture: (work: (fixture: any) => Promise<void>) => Promise<void>, storage: { getReadStream: any },
  withLicenseFixture: (work: (sign: (claims?: Record<string, unknown>) => string) => Promise<void>) => Promise<void>,
  withHostedFixture: (work: (fixture: any) => Promise<void>) => Promise<void>) {
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

  it('portable workspace prepared download rejects an expired staging lease before opening a transaction', async () => workspace(async f => {
    const fs = await import('node:fs/promises'), path = await import('node:path');
    const prepared = await f.prepare();
    const name = (await fs.readdir(f.root)).find(name => name.startsWith('alga-portable-archive-'))!;
    const marker = JSON.parse(await fs.readFile(path.join(f.root, name, '.alga-portable-lease.json'), 'utf8'));
    const clock = vi.spyOn(Date, 'now').mockReturnValue(marker.expiresAt), transaction = vi.spyOn(getDb(), 'transaction');
    try {
      await expect(prepared.acquireDownload()).rejects.toThrow('staging lease has expired');
      expect(transaction).not.toHaveBeenCalled();
      expect(await fs.readdir(f.root)).toEqual([]);
    } finally { clock.mockRestore(); transaction.mockRestore(); await prepared.dispose(); }
  }));

  it('portable export browser handler streams after releasing database locks and rejects revoked or foreign requests', async () => workspace(async f => {
    const auth = await import('@alga-psa/auth'), database = await import('@alga-psa/db');
    const session = vi.spyOn(auth, 'getSession').mockResolvedValue({ session_id: f.customerPrincipal.sessionId,
      user: { id: f.customerPrincipal.userId, tenant: f.customerPrincipal.tenant, user_type: 'internal' } } as any);
    const override = vi.spyOn(auth, 'getApiKeyUserOverride').mockReturnValue(undefined);
    const connection = vi.spyOn(database, 'getConnection').mockResolvedValue(getDb());
    const oldOrigin = process.env.NEXTAUTH_URL; process.env.NEXTAUTH_URL = 'https://customer.example.test';
    const { handleCoManagedPortableExport } = await import('../../../../../ee/server/src/lib/co-managed/portableExportHandler');
    const request = (origin = 'https://customer.example.test', body = new URLSearchParams({ passphrase: f.passphrase }).toString(), extraHeaders: Record<string, string> = {}) => new Request('https://customer.example.test/api/co-management/export',
      { method: 'POST', headers: { ...(origin === null ? {} : { origin }), 'content-type': 'application/x-www-form-urlencoded', ...extraHeaders }, body });
    try {
      expect((await handleCoManagedPortableExport(request('https://foreign.example.test'))).status).toBe(403);
      expect((await handleCoManagedPortableExport(request(undefined, 'passphrase=short'))).status).toBe(400);
      expect((await handleCoManagedPortableExport(request(undefined, 'passphrase=' + 'x'.repeat(5000)))).status).toBe(400);
      // The export screen's own target="_blank" rel="noopener" form makes the
      // browser send Origin: null; a cross-site request must still be refused
      // whether or not the Origin header is present, and a null Origin with no
      // Sec-Fetch-Site proof cannot be accepted. (The accepted null-origin path
      // is exercised by the real 200 download below.)
      expect((await handleCoManagedPortableExport(request(null as any, undefined, { 'sec-fetch-site': 'cross-site' }))).status).toBe(403);
      expect((await handleCoManagedPortableExport(request('https://customer.example.test', undefined, { 'sec-fetch-site': 'cross-site' }))).status).toBe(403);
      expect((await handleCoManagedPortableExport(request(null as any))).status).toBe(403);
      expect(f.provider).not.toHaveBeenCalled();
      // Realistic browser shape: Origin: null (noopener form) + same-origin proof.
      const response = await handleCoManagedPortableExport(request(null as any, undefined, { 'sec-fetch-site': 'same-origin' }));
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
    const business = await seedPortableWorkflowTaskHistory(f);
    const { escalateCoManagedTicket, handBackCoManagedTicket } = await import('../../../../../packages/co-managed/src/ticketHandoffs');
    await escalateCoManagedTicket(getDb(), f.customerPrincipal, f.resource, { operationId: randomUUID(), expectedRevision: 0, note: 'Retain this historical escalation' });
    await handBackCoManagedTicket(getDb(), f.principal, f.resource, { operationId: randomUUID(), expectedRevision: 1, note: 'Retain this historical MSP handback' });
    const contactId = randomUUID(), threadId = randomUUID(), commentId = randomUUID();
    const ticket = await f.customer.table('tickets').where('ticket_id', f.resource.id).first();
    await f.customer.table('contacts').insert({ tenant: f.actor.tenant, contact_name_id: contactId, full_name: 'Portable contact', client_id: ticket.client_id });
    await f.customer.table('contact_phone_numbers').insert({ tenant: f.actor.tenant, contact_phone_number_id: randomUUID(), contact_name_id: contactId,
      phone_number: '+1 (206) 555-0142', canonical_type: 'work' });
    await f.customer.table('comment_threads').insert({ tenant: f.actor.tenant, thread_id: threadId, ticket_id: f.resource.id, root_comment_id: commentId, is_internal: false, created_by: f.actor.userId });
    const sourceImageUrl = `/api/documents/view/${f.fileId}?download=false#image`;
    const sourceNote = JSON.stringify([{ type: 'image', props: { url: sourceImageUrl, caption: f.fileId } },
      { type: 'paragraph', content: [{ type: 'text', text: sourceImageUrl }] }]);
    await f.customer.table('comments').insert({ tenant: f.actor.tenant, comment_id: commentId, thread_id: threadId, ticket_id: f.resource.id,
      user_id: f.actor.userId, note: sourceNote, markdown_content: `![Caption](${sourceImageUrl})\n\n\`${sourceImageUrl}\``,
      is_internal: false, is_resolution: false, publish_state: 'published' });
    await f.customer.table('documents').where('document_id', f.documentId).update({ content: `<p>Legacy <img src='${sourceImageUrl}' alt='${f.fileId}'></p>` });
    await f.customer.table('document_block_content').insert({ tenant: f.actor.tenant, content_id: randomUUID(), document_id: f.documentId,
      block_data: JSON.stringify({ type: 'doc', content: [{ type: 'image', attrs: { src: sourceImageUrl } },
        { type: 'text', text: 'Download', marks: [{ type: 'link', attrs: { href: `/api/documents/download/${f.documentId}?format=pdf` } }] }] }) });
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
      const administratorUserId = String(records.domains.find(domain => domain.table === 'users' && domain.column === 'user_id')!.mappings.find(pair => pair.source === f.actor.userId)!.destination);
      const files = prepareCoManagedPortableWorkspaceFiles({ manifest: opened.manifest, files: opened.files, preparedRecords: records,
        importedByUserId: administratorUserId });
      const vault = await prepareCoManagedPortableWorkspaceVault({ manifest: opened.manifest, restoreRecords: records, passphrase: f.passphrase }, { reservedUuids: files.allocatedIds });
      lease = await stageCoManagedPortableWorkspaceFiles(files, {
        getCapabilities: () => ({ supportsStreaming: true, maxFileSize: 1024 ** 3 }),
        upload: async (stream: any, path: string, options: any) => { const chunks = []; for await (const chunk of stream) chunks.push(Buffer.from(chunk));
          const bytes = Buffer.concat(chunks); objects.set(path, bytes); return { path, size: bytes.length, mime_type: options.mime_type }; },
        delete: async (path: string) => { objects.delete(path); },
      } as any);
      const input = { preparedRecords: files, externalFiles: lease.externalFiles, vault, archive: { packageId: handle.packageId, sha256: handle.sha256,
        sourceAdministratorUserId: f.actor.userId, administratorUserId } };
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
      expect(await own.table('workflow_tasks')).toEqual([]); expect(await own.table('workflow_task_history')).toEqual([]);
      const businessHistory = await own.table('audit_logs').where('table_name', 'workflow_tasks');
      expect(businessHistory).toHaveLength(3);
      expect(businessHistory.find((row: any) => row.details.source_task_id === business.taskId && row.operation === 'portable_workflow_task_restored')?.details)
        .toMatchObject({ source_tenant: f.actor.tenant, actor_identity: 'source_tenant', execution_state: 'not_restored',
          portable_workflow_task: { response_data: business.response, completed_by: business.formerUserId, completed_by_name: 'Former Technician' } });
      const responseHistory = businessHistory.find((row: any) => row.operation === 'portable_workflow_task_activity_restored');
      expect(responseHistory.details.portable_workflow_task_activity.details).toEqual({ formData: business.response });
      expect(responseHistory.user_id).toBe(records.domains.find(domain => domain.table === 'users' && domain.column === 'user_id')?.mappings.find(pair => pair.source === f.actor.userId)?.destination);
      expect(JSON.stringify(businessHistory)).not.toMatch(/execution_id|context_data|claimed_by|provider-secret-never-export/);
      const history = await own.table('ticket_audit_logs').where('event_type', 'TICKET_HANDOFF_RESTORED');
      expect(history).toHaveLength(2); expect(history.map((row: any) => row.details.portable_handoff.note)).toContain('Retain this historical MSP handback');
      const restoredThread = await own.table('comment_threads').first(), restoredComment = await own.table('comments').first();
      expect(restoredThread.root_comment_id).toBe(restoredComment.comment_id); expect(restoredComment.thread_id).toBe(restoredThread.thread_id);
      expect((await own.table('contact_phone_numbers').first()).normalized_phone_number).toBe((await f.customer.table('contact_phone_numbers').first()).normalized_phone_number);
      const suspension = await import('@alga-psa/db');
      expect(await suspension.resumeTenant(getDb(), destinationTenant, 'tenant_cancelled')).toBe(false);
      expect(await suspension.isTenantSuspended(getDb(), destinationTenant)).toBe(true);
      const licensing = await import('../../../../../packages/licensing/src/lib/tenant-license-state');
      expect(await licensing.getTenantLicenseManagementScope(getDb(), destinationTenant)).toBe('tenant');
      expect(await licensing.getTenantSelfHostLicenseState(destinationTenant, getDb())).toMatchObject({ license_scope: 'tenant', license_token: null });
      await expect(own.table('portable_workspace_restores').update({ source_tenant: randomUUID() })).rejects.toThrow('immutable');
      const migration = (await import('../../../../../server/migrations/20260908191851_add_portable_restore_suspension.cjs')).default;
      await expect(migration.down(getDb())).rejects.toThrow('awaits activation');
      expect((await own.table('tickets')).map((row: any) => row.title)).toEqual(records.records.tickets.map(row => row.title));
      const credential = await own.table('credentials').first();
      expect(await f.encryption.decryptCredentialValue(credential.password_ciphertext, credential.encryption_scheme)).toBe('customer recovery password');
      const file = await own.table('external_files').first(); expect(objects.get(file.storage_path)?.equals(f.bytes)).toBe(true);
      const document = await own.table('documents').where('file_id', file.file_id).first();
      const restoredNote = JSON.parse(restoredComment.note);
      expect(restoredNote[0].props).toEqual({ url: `/api/documents/view/${file.file_id}?download=false#image`, caption: f.fileId });
      expect(restoredNote[1].content[0].text).toBe(sourceImageUrl);
      expect(restoredComment.markdown_content).toBe(`![Caption](/api/documents/view/${file.file_id}?download=false#image)\n\n\`${sourceImageUrl}\``);
      expect(document.content).toBe(`<p>Legacy <img src='/api/documents/view/${file.file_id}?download=false#image' alt='${f.fileId}'></p>`);
      const block = await own.table('document_block_content').where('document_id', document.document_id).first();
      const rich = typeof block.block_data === 'string' ? JSON.parse(block.block_data) : block.block_data;
      expect(rich.content[0].attrs.src).toBe(`/api/documents/view/${file.file_id}?download=false#image`);
      expect(rich.content[1].marks[0].attrs.href).toBe(`/api/documents/download/${document.document_id}?format=pdf`);
      expect((await f.customer.table('comments').where('comment_id', commentId).first()).note).toBe(sourceNote);
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

  it('portable installation restore authenticates owner authority and converges retries without replacing tenants', async () => workspace(async f => {
    const { restorePortableWorkspaceForInstallation, inspectPortableWorkspaceArchive, assertPortableRestoreInstallationAuthority } =
      await import('../../../../../ee/server/src/lib/co-managed/portableWorkspaceRestore');
    const { tenantDb } = await import('@alga-psa/db');
    const db = getDb(), handle = await f.prepare(), archivePath = `${f.root}/operator.alga`;
    await handle.consume(async (artifact: any) => f.fs.copyFile(artifact.path, archivePath));
    const info = await inspectPortableWorkspaceArchive(archivePath, f.passphrase);
    expect(info).toMatchObject({ sourceTenant: f.actor.tenant, packageId: handle.packageId, sha256: handle.sha256 });
    expect(info.administrators.some(user => user.userId === f.actor.userId)).toBe(true);
    const { spawn } = await import('node:child_process'), { createRequire } = await import('node:module'), { resolve } = await import('node:path');
    const cli = createRequire(import.meta.url).resolve('tsx/cli');
    const inspected = await new Promise<string>((resolveResult, reject) => {
      const child = spawn(process.execPath, [cli, '--tsconfig', resolve('../ee/server/tsconfig.json'),
        resolve('scripts/restore-portable-workspace.ts'), '--inspect', '--archive', archivePath, '--passphrase-stdin'], { stdio: ['pipe', 'pipe', 'pipe'] });
      let output = '', errors = '';
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Restore CLI timed out')); }, 15_000);
      child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { errors += chunk; });
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('close', code => { clearTimeout(timer); code === 0 ? resolveResult(output) : reject(new Error(`Restore CLI exited ${code}: ${errors}`)); });
      child.stdin.end(f.passphrase);
    });
    expect(JSON.parse(inspected)).toEqual(info);
    const objects = new Map<string, Buffer>();
    const provider = { getLocationIdentity: () => 'a'.repeat(64), getCapabilities: () => ({ supportsStreaming: true, maxFileSize: 1024 ** 3 }),
      upload: vi.fn(async (stream: AsyncIterable<Buffer>, path: string, options: any) => {
        const chunks: Buffer[] = []; for await (const chunk of stream) chunks.push(Buffer.from(chunk));
        const bytes = Buffer.concat(chunks); objects.set(path, bytes);
        return { path, size: bytes.length, mime_type: options.mime_type };
      }), delete: vi.fn(async (path: string) => { objects.delete(path); }) };
    const createProvider = vi.fn(async () => provider as any);
    const input = { archivePath, passphrase: f.passphrase, destinationTenant: randomUUID(), sourceAdministratorUserId: f.actor.userId };
    await expect(restorePortableWorkspaceForInstallation(db, { ...input, sourceAdministratorUserId: randomUUID() }, {}, createProvider)).rejects.toThrow('administrator');
    expect(createProvider).not.toHaveBeenCalled();
    const role = `portable_restore_test_${randomUUID().replaceAll('-', '')}`;
    await expect(db.transaction(async trx => {
      await trx.raw(`CREATE ROLE "${role}" NOLOGIN`);
      await trx.raw(`SET LOCAL ROLE "${role}"`);
      await assertPortableRestoreInstallationAuthority(trx);
    })).rejects.toThrow('database owner authority');
    expect(await db('pg_roles').where('rolname', role).first()).toBeUndefined();
    const failedTenant = randomUUID(), upload = provider.upload.getMockImplementation()!;
    provider.upload.mockImplementationOnce(async (...args: Parameters<typeof upload>) => { await upload(...args); throw new Error('Provider failed after storing bytes'); });
    await expect(restorePortableWorkspaceForInstallation(db, { ...input, destinationTenant: failedTenant }, {}, createProvider)).rejects.toThrow('Provider failed');
    expect(objects.size).toBe(0); expect(await tenantDb(db, failedTenant).table('tenants').first()).toBeUndefined();
    const { cleanupPortableRestoreUploads: cleanup, commitPortableRestoreUpload } = await import('../../../../../ee/server/src/lib/co-managed/portableWorkspaceRestoreUploads');
    const recovery = tenantDb(db, failedTenant), failedAttempt = await recovery.table('portable_workspace_restore_uploads').first();
    expect(failedAttempt.status).toBe('abandoned');
    const objectPath = (attempt: any) => `${failedTenant}/portable-restores/${attempt.attempt_id}/${attempt.file_ids[0]}`;
    objects.set(objectPath(failedAttempt), Buffer.from('Provider finished after process cleanup'));
    expect(await cleanup(db, failedTenant, { ...provider, getLocationIdentity: () => 'b'.repeat(64) })).toEqual({ cleaned: 0, failed: 0, skipped: 0 });
    expect(objects.has(objectPath(failedAttempt))).toBe(true);
    expect(await cleanup(db, failedTenant, provider)).toMatchObject({ cleaned: 1, failed: 0 });
    expect(objects.size).toBe(0);
    // A second late provider result must remain recoverable after a clean sweep.
    objects.set(objectPath(failedAttempt), Buffer.from('Late provider bytes'));
    await recovery.table('portable_workspace_restore_uploads').where('attempt_id', failedAttempt.attempt_id).update({ next_cleanup_at: db.fn.now() });
    expect(await cleanup(db, failedTenant, provider)).toMatchObject({ cleaned: 1 }); expect(objects.size).toBe(0);
    const activeAttempt = { ...failedAttempt, attempt_id: randomUUID(), status: 'uploading', created_at: db.fn.now(),
      expires_at: db.raw("clock_timestamp() + interval '35 minutes'"), next_cleanup_at: db.fn.now(), file_ids: JSON.stringify(failedAttempt.file_ids) };
    await recovery.table('portable_workspace_restore_uploads').insert(activeAttempt);
    const activePath = `${failedTenant}/portable-restores/${activeAttempt.attempt_id}/${failedAttempt.file_ids[0]}`;
    objects.set(activePath, Buffer.from('Active attempt'));
    expect(await cleanup(db, failedTenant, provider)).toMatchObject({ cleaned: 0, skipped: 1 }); expect(objects.has(activePath)).toBe(true);
    const expired = { ...activeAttempt, attempt_id: randomUUID(), created_at: db.raw("clock_timestamp() - interval '1 hour'"),
      expires_at: db.raw("clock_timestamp() - interval '1 minute'") };
    await recovery.table('portable_workspace_restore_uploads').insert(expired);
    const expiredPath = `${failedTenant}/portable-restores/${expired.attempt_id}/${failedAttempt.file_ids[0]}`;
    objects.set(expiredPath, Buffer.from('Crashed attempt'));
    provider.delete.mockRejectedValueOnce(new Error('Storage unavailable'));
    expect(await cleanup(db, failedTenant, provider)).toMatchObject({ cleaned: 0, failed: 1 });
    expect((await recovery.table('portable_workspace_restore_uploads').where('attempt_id', expired.attempt_id).first()).status).toBe('abandoned');
    await expect(db.transaction(trx => commitPortableRestoreUpload(trx, { tenant: failedTenant, attemptId: expired.attempt_id, providerIdentity: provider.getLocationIdentity() }, []))).rejects.toThrow('upload recovery rejected');
    await recovery.table('portable_workspace_restore_uploads').where('attempt_id', expired.attempt_id).update({ next_cleanup_at: db.fn.now() });
    expect(await cleanup(db, failedTenant, provider)).toMatchObject({ cleaned: 1, failed: 0 }); expect(objects.has(expiredPath)).toBe(false);
    objects.delete(activePath);
    createProvider.mockClear();
    const receipt = await restorePortableWorkspaceForInstallation(db, input, {}, createProvider);
    expect(receipt).toMatchObject({ tenant: input.destinationTenant, source_tenant: f.actor.tenant, package_id: info.packageId,
      archive_sha256: info.sha256, source_administrator_user_id: f.actor.userId });
    expect((await tenantDb(db, input.destinationTenant).table('tenants').first()).suspended_reason).toBe('portable_restore_pending_activation');
    expect((await tenantDb(db, input.destinationTenant).table('portable_workspace_restore_uploads').first()).status).toBe('committed');
    expect(await cleanup(db, input.destinationTenant, provider)).toEqual({ cleaned: 0, failed: 0, skipped: 0 });
    const referencedId = randomUUID(), referencedAttempt = { tenant: receipt.tenant, attemptId: randomUUID() };
    await tenantDb(db, receipt.tenant).table('portable_workspace_restore_uploads').insert({ ...expired, tenant: receipt.tenant,
      attempt_id: referencedAttempt.attemptId, file_ids: JSON.stringify([referencedId]) });
    const referencedPath = `${receipt.tenant}/portable-restores/${referencedAttempt.attemptId}/${referencedId}`;
    const native = await tenantDb(db, receipt.tenant).table('external_files').first(), copyId = randomUUID();
    await tenantDb(db, receipt.tenant).table('external_files').insert({ ...native, file_id: copyId, file_name: copyId, storage_path: referencedPath });
    objects.set(referencedPath, Buffer.from('Native copy with a different file identity'));
    expect(await cleanup(db, receipt.tenant, provider)).toMatchObject({ cleaned: 0, skipped: 1 });
    expect(objects.has(referencedPath)).toBe(true);
    const globalAttempt = { ...expired, attempt_id: randomUUID() };
    await recovery.table('portable_workspace_restore_uploads').insert(globalAttempt);
    const globalPath = `${failedTenant}/portable-restores/${globalAttempt.attempt_id}/${failedAttempt.file_ids[0]}`;
    objects.set(globalPath, Buffer.from('No tenant was ever created for this destination'));
    const { portableRestoreUploadCleanupHandler } = await import('@alga-psa/jobs/handlers/portableRestoreUploadCleanupHandler');
    const admin = await import('@alga-psa/db/admin'), { StorageProviderFactory } = await import('@alga-psa/storage/StorageProviderFactory');
    const connection = vi.spyOn(admin, 'getAdminConnection').mockResolvedValue(db);
    const factory = vi.spyOn(StorageProviderFactory, 'createProvider').mockResolvedValue(provider as any);
    try { expect(await portableRestoreUploadCleanupHandler()).toMatchObject({ schemaReady: true, cleaned: expect.any(Number) }); }
    finally { connection.mockRestore(); factory.mockRestore(); }
    expect(objects.has(globalPath)).toBe(false);
    expect(objects.has(referencedPath)).toBe(true);
    await tenantDb(db, receipt.tenant).table('external_files').where('file_id', copyId).del();
    await tenantDb(db, receipt.tenant).table('portable_workspace_restore_uploads').where('attempt_id', referencedAttempt.attemptId).update({ next_cleanup_at: db.fn.now() });
    expect(await cleanup(db, receipt.tenant, provider)).toMatchObject({ cleaned: 1 });
    expect((await tenantDb(db, receipt.tenant).table('portable_workspace_restore_uploads').where('attempt_id', referencedAttempt.attemptId).first()).status).toBe('abandoned');
    await expect(tenantDb(db, receipt.tenant).table('external_files').insert({ ...native, file_id: copyId, file_name: copyId, storage_path: referencedPath }))
      .rejects.toThrow('cannot acquire a native reference');
    const uploads = provider.upload.mock.calls.length, reads = f.provider.mock.calls.length;
    expect([...objects.values()].some(bytes => bytes.equals(f.bytes))).toBe(true);
    expect(await restorePortableWorkspaceForInstallation(db, input, {}, createProvider)).toEqual(receipt);
    expect(createProvider).toHaveBeenCalledTimes(1); expect(provider.upload).toHaveBeenCalledTimes(uploads); expect(f.provider).toHaveBeenCalledTimes(reads);
    const changed = await f.prepare(), changedPath = `${f.root}/different.alga`;
    await changed.consume(async (artifact: any) => f.fs.copyFile(artifact.path, changedPath));
    await expect(restorePortableWorkspaceForInstallation(db, { ...input, archivePath: changedPath }, {}, createProvider)).rejects.toThrow('destination already');
    expect(createProvider).toHaveBeenCalledTimes(1);
    // The real tsx child retains its own IPC/cache directory, not restore data.
    expect((await f.fs.readdir(f.root)).sort()).toEqual(['different.alga', 'operator.alga', `tsx-${process.getuid!()}`]);
    const uncertainTenant = randomUUID(), transaction = db.transaction.bind(db);
    const acknowledgement = vi.spyOn(db, 'transaction').mockImplementation(async (...args: any[]) => {
      const result = await (transaction as any)(...args);
      if (result?.inserted === true) throw new Error('Lost restore commit acknowledgement');
      return result;
    });
    try {
      await expect(restorePortableWorkspaceForInstallation(db, { ...input, destinationTenant: uncertainTenant }, {}, createProvider)).rejects.toThrow('Lost restore commit acknowledgement');
    } finally { acknowledgement.mockRestore(); }
    const committedFiles = await tenantDb(db, uncertainTenant).table('external_files').select('storage_path');
    expect(committedFiles.length).toBeGreaterThan(0);
    for (const file of committedFiles) expect(objects.has(file.storage_path)).toBe(true);
    const beforeRetry = provider.upload.mock.calls.length;
    expect(await restorePortableWorkspaceForInstallation(db, { ...input, destinationTenant: uncertainTenant }, {}, createProvider)).toMatchObject({ tenant: uncertainTenant });
    expect(provider.upload).toHaveBeenCalledTimes(beforeRetry);
    await withLicenseFixture(async sign => {
      const { activatePortableWorkspaceWithTenantLicense: activate } = await import('../../../../../ee/server/src/lib/co-managed/portableWorkspaceActivation');
      const { verifyPassword } = await import('@alga-psa/core/encryption');
      const own = tenantDb(db, receipt.tenant), installation = await db('license_state').first(), log = { info: vi.fn(), error: vi.fn() };
      const activation = { tenant: receipt.tenant, operationId: randomUUID(), licenseToken: sign({ aud: receipt.tenant, seats: 2 }), administratorPassword: 'Restored!Desk47Secure' };
      await expect(activate(db, { ...activation, licenseToken: sign({ aud: f.actor.tenant }) }, log)).rejects.toThrow('bound to this tenant');
      expect(await own.table('tenant_license_state').first()).toBeUndefined();
      const beforeRoles = await own.table('roles').count('* as count').first();
      await db.raw(db.raw(`ALTER TABLE portable_workspace_activations ADD CONSTRAINT portable_activation_failure CHECK (tenant <> ?::uuid)`, [receipt.tenant]).toQuery());
      try { await expect(activate(db, activation, log)).rejects.toThrow('portable_activation_failure'); }
      finally { await db.raw('ALTER TABLE portable_workspace_activations DROP CONSTRAINT portable_activation_failure'); }
      expect(await own.table('tenant_license_state').first()).toBeUndefined();
      expect(await own.table('roles').count('* as count').first()).toEqual(beforeRoles);
      expect((await own.table('users').where('user_id', receipt.administrator_user_id).first()).hashed_password).toBe('!portable-restore-disabled');
      const activated = await activate(db, activation, log);
      expect(activated).toMatchObject({ tenant: receipt.tenant, operation_id: activation.operationId, administrator_user_id: receipt.administrator_user_id,
        entitlement_source: 'tenant_license', seats: 2 });
      const administrator = await own.table('users').where('user_id', receipt.administrator_user_id).first();
      expect(administrator.is_inactive).toBe(false); expect(await verifyPassword(activation.administratorPassword, administrator.hashed_password)).toBe(true);
      expect(await own.table('users').where('is_inactive', false).select('user_id')).toEqual([{ user_id: receipt.administrator_user_id }]);
      expect((await own.table('tenants').first()).suspended_at).toBeNull(); expect(await db('license_state').first()).toEqual(installation);
      expect(await own.table('roles').where({ role_name: 'Finance', msp: true }).first()).toBeDefined();
      await own.table('tenants').update({ suspended_at: db.fn.now(), suspended_reason: 'tenant_cancelled' });
      expect(await activate(db, { ...activation, licenseToken: 'no longer needed', administratorPassword: 'DoesNotReset!89' }, log)).toEqual(activated);
      expect((await own.table('users').where('user_id', receipt.administrator_user_id).first()).hashed_password).toBe(administrator.hashed_password);
      expect((await own.table('tenants').first()).suspended_reason).toBe('tenant_cancelled');
      await expect(activate(db, { ...activation, operationId: randomUUID() }, log)).rejects.toThrow('another activation');
    });
    await withHostedFixture(async hosted => {
      const { activatePortableWorkspaceWithHostedSubscription: activate } = await import('../../../../../ee/server/src/lib/co-managed/portableWorkspaceActivation');
      const tenant = randomUUID(), restored = await restorePortableWorkspaceForInstallation(db, { ...input, destinationTenant: tenant }, {}, createProvider);
      const own = tenantDb(db, tenant), customerId = randomUUID(), subscriptionId = randomUUID();
      const customer = { ...await hosted.customer.table('stripe_customers').first(), tenant, stripe_customer_id: customerId, stripe_customer_external_id: `cus_${customerId}` };
      const subscription = { ...await hosted.customer.table('stripe_subscriptions').first(), tenant, stripe_subscription_id: subscriptionId,
        stripe_customer_id: customerId, stripe_subscription_external_id: `sub_${subscriptionId}`, metadata: { tenant_id: tenant } };
      await own.table('stripe_customers').insert(customer); await own.table('stripe_subscriptions').insert(subscription);
      hosted.providerCustomer.id = customer.stripe_customer_external_id; hosted.providerCustomer.metadata.tenant_id = tenant;
      Object.assign(hosted.providerSubscription, { id: subscription.stripe_subscription_external_id, customer: customer.stripe_customer_external_id, metadata: { tenant_id: tenant } });
      Object.assign(hosted.providerSubscription.latest_invoice, { customer: customer.stripe_customer_external_id, subscription: subscription.stripe_subscription_external_id });
      const activation = { tenant, operationId: randomUUID(), administratorPassword: 'Hosted!Desk47Secure' }, log = { info: vi.fn(), error: vi.fn() };
      const dependencies = { stripe: hosted.stripe, prices: hosted.prices };
      hosted.providerSubscription.latest_invoice.status = 'open';
      await expect(activate(db, activation, log, dependencies)).rejects.toThrow();
      expect((await own.table('tenants').first()).suspended_reason).toBe('portable_restore_pending_activation');
      hosted.providerSubscription.latest_invoice.status = 'paid';
      const read = hosted.stripe.subscriptions.retrieve.getMockImplementation();
      hosted.stripe.subscriptions.retrieve.mockImplementationOnce(async (...args: any[]) => {
        // A provider read must not retain the destination row lock. A changed
        // local billing row must invalidate the already prepared candidate.
        await db.transaction(async trx => { await trx.raw("SET LOCAL lock_timeout = '100ms'");
          await tenantDb(trx, tenant).table('stripe_subscriptions').update({ updated_at: trx.raw("clock_timestamp() + interval '1 second'") }); });
        return read(...args);
      });
      await expect(activate(db, activation, log, dependencies)).rejects.toThrow('destination subscription changed');
      expect(await own.table('portable_workspace_activations').first()).toBeUndefined();
      const activated = await activate(db, activation, log, dependencies);
      expect(activated).toMatchObject({ tenant, administrator_user_id: restored.administrator_user_id, entitlement_source: 'hosted_subscription',
        entitlement_reference: subscription.stripe_subscription_external_id, seats: 4 });
      const reads = hosted.stripe.subscriptions.retrieve.mock.calls.length;
      expect(await activate(db, activation, log, dependencies)).toEqual(activated);
      expect(hosted.stripe.subscriptions.retrieve).toHaveBeenCalledTimes(reads);
      expect(await own.table('tenant_license_state').first()).toBeUndefined();
      expect(await own.table('stripe_subscriptions').first()).toMatchObject({ stripe_subscription_id: subscriptionId, status: 'active', quantity: 4 });
    });
  }));

  it('portable workspace preparation enforces cumulative disk limits and cancels provider work without retained staging', async () => workspace(async f => {
    for (const options of [{ maxWrittenBytes: f.bytes.length - 1 }, { minFreeBytes: Number.MAX_SAFE_INTEGER }]) {
      await expect(f.prepareCoManagedPortableWorkspaceExport(getDb(), f.customerPrincipal, f.passphrase, options)).rejects.toThrow();
      expect(await f.fs.readdir(f.root)).toEqual([]);
    }
    const { Readable } = await import('node:stream'), abort = new AbortController();
    const late = new Readable({ read() {} });
    storage.getReadStream.mockImplementation(async () => { abort.abort(); return late; });
    await expect(f.prepareCoManagedPortableWorkspaceExport(getDb(), f.customerPrincipal, f.passphrase, { signal: abort.signal })).rejects.toThrow();
    expect(late.destroyed).toBe(true); expect(await f.fs.readdir(f.root)).toEqual([]);
    storage.getReadStream.mockImplementation(f.stream);
    const vaultAbort = new AbortController(), provider = f.provider.getMockImplementation();
    f.provider.mockImplementation(async (...args: any[]) => { vaultAbort.abort(); return provider(...args); });
    await expect(f.prepareCoManagedPortableWorkspaceExport(getDb(), f.customerPrincipal, f.passphrase, { signal: vaultAbort.signal })).rejects.toThrow();
    expect(await f.fs.readdir(f.root)).toEqual([]);
  }));
}
