import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { CO_MANAGED_PORTABLE_RESTORE_SECTIONS, prepareCoManagedPortableWorkspaceRecords } from '../../../../../packages/co-managed/src/portableWorkspaceRestoreRecords';
import { buildCoManagedPortableWorkspaceManifest } from '../../../../../packages/co-managed/src/portableWorkspaceManifest';
import { prepareCoManagedPortableWorkspaceFiles, stageCoManagedPortableWorkspaceFiles } from '../../../../../packages/co-managed/src/portableWorkspaceRestoreFiles';
import { openPortableArchive, sealPortableArchive } from '../../../../../packages/co-managed/src/portableArchive';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const context = { packageId: id(1), sourceTenant: id(2), capturedAt: '2026-09-08T12:00:00.000Z' };
const destinationTenant = id(3), importedByUserId = id(1000);
const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const sign = (value: Record<string, unknown>) => ({ ...value, sha256: hash(JSON.stringify(value)) });
function fixture() {
  const sectionRecords: Record<string, Record<string, any[]>> = Object.fromEntries(Object.entries(CO_MANAGED_PORTABLE_RESTORE_SECTIONS)
    .map(([section, tables]) => [section, Object.fromEntries(Object.keys(tables).map(table => [table, []]))]));
  const add = (table: string, values: Record<string, unknown>) => {
    const section = Object.keys(CO_MANAGED_PORTABLE_RESTORE_SECTIONS).find(section => Object.hasOwn(CO_MANAGED_PORTABLE_RESTORE_SECTIONS[section as keyof typeof CO_MANAGED_PORTABLE_RESTORE_SECTIONS], table))!;
    const columns = (CO_MANAGED_PORTABLE_RESTORE_SECTIONS[section as keyof typeof CO_MANAGED_PORTABLE_RESTORE_SECTIONS] as Record<string, readonly string[]>)[table];
    const row = Object.assign(Object.fromEntries(columns.map(column => [column, null])), values);
    sectionRecords[section][table].push(row); return row;
  };
  add('tenants', { client_name: 'Customer' }); add('users', { user_id: id(11) }); add('tickets', { ticket_id: id(10) });
  add('collaboration_actor_references', { actor_reference_id: id(90), actor_tenant: id(80), actor_user_id: id(81) });
  add('documents', { document_id: id(20), document_name: 'Native', user_id: id(11), created_by: id(11), file_id: id(30), preview_file_id: id(31), order_number: 5 });
  add('documents', { document_id: id(21), document_name: 'Legacy', user_id: id(11), created_by: id(11), order_number: 6 });
  add('appointment_requests', { appointment_request_id: id(39) }); add('online_meetings', { meeting_id: id(38), appointment_request_id: id(39) });
  add('online_meeting_artifacts', { artifact_id: id(40), meeting_id: id(38), document_id: id(20), file_id: id(30), artifact_type: 'recording' });
  add('online_meeting_artifacts', { artifact_id: id(41), meeting_id: id(38), artifact_type: 'recording' });
  add('online_meeting_artifacts', { artifact_id: id(42), meeting_id: id(38), file_id: id(32), artifact_type: 'transcript' });
  const blobs = new Map<string, { id: string; size: number; sha256: string; name: string; mimeType: string }>();
  const bytes = new Map<string, Buffer>();
  const blob = (blobId: string, name = 'customer.bin') => {
    const content = Buffer.from(`Authenticated customer bytes: ${blobId}`); bytes.set(blobId, content);
    const descriptor = { id: blobId, size: content.length, sha256: hash(content), name, mimeType: 'application/octet-stream' };
    blobs.set(blobId, descriptor); return descriptor;
  };
  const documents = { fileBindings: [{ documentId: id(20), field: 'file_id', blobId: `file:${id(30)}` },
    { documentId: id(20), field: 'preview_file_id', blobId: `file:${id(31)}` }, { documentId: id(21), field: 'file_id', blobId: `document:${id(21)}` }],
    blobs: [blob(`file:${id(30)}`), blob(`file:${id(31)}`), blob(`document:${id(21)}`)] };
  const supplemental = { fileBindings: [40, 42].map(n => ({ table: 'online_meeting_artifacts', recordId: id(n), field: 'file_id', blobId: `file:${id(n === 40 ? 30 : 32)}` })), blobs: [blob(`file:${id(32)}`)] };
  const remote = { fileBindings: [{ table: 'online_meeting_artifacts', recordId: id(41), field: 'content', blobId: `meeting_artifact:${id(41)}` }], blobs: [blob(`meeting_artifact:${id(41)}`)] };
  const attachments = ['requester', 'shared_it', 'organization_private'].map((audience, n) => {
    add('comment_threads', { thread_id: id(50 + n), ticket_id: id(10), root_comment_id: id(60 + n), is_internal: n !== 0, collaboration_audience: audience });
    add('comments', { comment_id: id(60 + n), thread_id: id(50 + n), ticket_id: id(10), is_internal: n !== 0, publish_state: 'published',
      actor_reference_id: n === 1 ? id(90) : null, actor_display_name: 'Saved author', actor_organization_name: 'Saved organization', note: `Authored source link /attachments/${id(70 + n)}` });
    const descriptor = blob(`attachment:${id(70 + n)}`, n === 1 ? '../../do-not-use-as-storage-key.bin' : 'Customer file.bin');
    return { attachmentId: id(70 + n), blobId: descriptor.id, ticketId: id(10), threadId: id(50 + n), commentId: id(60 + n), audience,
      fileName: descriptor.name, mimeType: descriptor.mimeType, size: descriptor.size, sha256: descriptor.sha256, createdAt: context.capturedAt,
      actorTenant: n === 1 ? id(80) : context.sourceTenant, actorUserId: n === 0 ? id(11) : n === 1 ? id(81) : id(12),
      actorReferenceId: n === 1 ? id(90) : null, actorDisplayName: 'Saved author', actorOrganizationName: 'Saved organization' };
  });
  const component = (kind: string, values: Record<string, unknown>) => sign({ kind: `alga-workspace-${kind}`, version: 1, packageId: context.packageId, sourceTenant: context.sourceTenant, ...values });
  const sections = Object.fromEntries(Object.entries(sectionRecords).map(([section, records]) => [section, component(section, {
    records, references: [], ...(section === 'documents' ? documents : { capturedAt: context.capturedAt, restorePolicy: {} }),
    ...(section === 'assets' ? { polymorphicReferences: [], typeReferences: [] } : section === 'operational' ? { polymorphicReferences: [] } :
      section === 'workflows' ? { referenceValueTypes: {}, conditionalReferences: [], dependencies: [], systemForms: [] } :
      section === 'engagement' ? { additionalReferences: [] } : {}),
  })]));
  const files = [...blobs.values()].map(({ id, size, sha256 }, n) => ({ id, size, sha256, path: `/tmp/restore-fixture-${n}` }));
  const manifest = buildCoManagedPortableWorkspaceManifest({ context, sections: sections as any, files,
    conversationFiles: component('conversation-files', { attachments, restorePolicy: {} }),
    supplementalFiles: component('supplemental-files', { ...supplemental, restorePolicy: {} }), remoteMeetingFiles: component('remote-meeting-files', { ...remote, restorePolicy: {} }),
    credentialVault: { vault: { format: 'alga-credential-vault:scrypt-aes-256-gcm:v1', packageId: context.packageId, sourceTenant: context.sourceTenant,
      salt: Buffer.alloc(16).toString('base64'), iv: Buffer.alloc(12).toString('base64'), tag: Buffer.alloc(16).toString('base64'), ciphertext: Buffer.from('opaque encrypted vault').toString('base64') }, credentials: [], grants: [], associations: [] } });
  let nextRecord = 1000;
  const preparedRecords = prepareCoManagedPortableWorkspaceRecords({ sourceTenant: context.sourceTenant, destinationTenant, sections: sectionRecords,
    destinationCatalogMappings: { standard_statuses: {}, shared_document_types: {}, system_interaction_types: {}, standard_service_types: {} } }, { allocateUuid: () => id(nextRecord++) });
  const prepare = (options = {}) => { let nextFile = 2000; return prepareCoManagedPortableWorkspaceFiles({ manifest, files, preparedRecords, importedByUserId }, { allocateUuid: () => id(nextFile++), ...options }); };
  return { manifest, preparedRecords, files, bytes, prepare };
}

it('binds native, preview, legacy and local/remote meeting files with one destination file per source blob', () => {
  const f = fixture(), original = structuredClone(f.preparedRecords), restored = f.prepare();
  expect(f.preparedRecords).toEqual(original); expect(restored.externalFiles).toHaveLength(8);
  const byBlob = new Map(restored.transfers.map(file => [file.id, file.fileId]));
  expect(restored.records.documents[0]).toMatchObject({ file_id: byBlob.get(`file:${id(30)}`), preview_file_id: byBlob.get(`file:${id(31)}`) });
  expect(restored.records.documents[1].file_id).toBe(byBlob.get(`document:${id(21)}`));
  expect(restored.records.online_meeting_artifacts.map(row => row.file_id)).toEqual([byBlob.get(`file:${id(30)}`), byBlob.get(`meeting_artifact:${id(41)}`), byBlob.get(`file:${id(32)}`)]);
  expect(restored.sections.documents.documents).toEqual(restored.records.documents);
  expect(restored.externalFiles.every(file => file.tenant === destinationTenant && !Object.hasOwn(file, 'storage_path'))).toBe(true);
  expect(new Set(restored.allocatedIds).size).toBe(14);
});

it('restores ticket attachment documents with precise historical audiences and qualified saved authors without editing authored text', () => {
  const f = fixture(), restored = f.prepare(), docs = restored.records.documents.slice(2);
  expect(docs.map(row => row.is_client_visible)).toEqual([true, false, false]);
  expect(docs.map(row => row.order_number)).toEqual([7, 8, 9]);
  expect(restored.records.document_associations.map(row => row.entity_id)).toEqual(Array(3).fill(restored.records.tickets[0].ticket_id));
  const metadata = restored.externalFiles.slice(-3).map(file => (file.metadata as any).conversation);
  expect(metadata.map(row => row.audience)).toEqual(['requester', 'shared_it', 'organization_private']);
  expect(metadata[0]).toMatchObject({ actor_tenant: destinationTenant, actor_user_id: restored.records.users[0].user_id, comment_id: restored.records.comments[0].comment_id });
  expect(metadata[1]).toMatchObject({ actor_tenant: id(80), actor_user_id: id(81), actor_reference_id: restored.records.collaboration_actor_references[0].actor_reference_id, actor_display_name: 'Saved author' });
  expect(metadata[2]).toMatchObject({ actor_tenant: context.sourceTenant, actor_user_id: id(12) });
  expect(docs[1].created_by).toBe(importedByUserId); expect(docs[0].created_by).toBe(restored.records.users[0].user_id);
  expect(restored.records.comments.map(row => row.note)).toEqual(f.preparedRecords.records.comments.map(row => row.note));
});

it('rejects missing blobs, wrong source bindings and allocated identity collisions before transport', () => {
  const f = fixture(); f.files.pop(); expect(() => f.prepare()).toThrow();
  const g = fixture(); g.preparedRecords.sourceTenant = id(999); expect(() => g.prepare()).toThrow();
  const h = fixture(); expect(() => h.prepare({ allocateUuid: () => id(30) })).toThrow();
  expect(() => h.prepare({ allocateUuid: () => String(h.preparedRecords.records.users[0].user_id) })).toThrow();
  expect(() => h.prepare({ reservedUuids: [id(2000)] })).toThrow();
  expect(() => h.prepare({ allocateUuid: () => id(9999) })).toThrow();
});

async function diskFixture(work: (f: ReturnType<typeof fixture>, root: string) => Promise<void>) {
  const f = fixture(), root = await mkdtemp(join(tmpdir(), 'portable-restore-files-test-'));
  try { for (const [n, file] of f.files.entries()) { file.path = join(root, `${n}.bin`); await writeFile(file.path, f.bytes.get(file.id)!); } await work(f, root); }
  finally { await rm(root, { recursive: true, force: true }); }
}
function storage() {
  const objects = new Map<string, Buffer>();
  const provider = { getCapabilities: () => ({ supportsStreaming: true, supportsBuckets: false, supportsMetadata: true, supportsTags: false, supportsVersioning: false, maxFileSize: 1024 ** 3 }),
    upload: vi.fn(async (stream: any, path: string, options: any) => { const chunks = []; for await (const chunk of stream) chunks.push(chunk); const bytes = Buffer.concat(chunks);
      expect(options.content_length).toBe(bytes.length);
      objects.set(path, bytes); return { path, size: bytes.length, mime_type: options.mime_type }; }),
    delete: vi.fn(async (path: string) => { objects.delete(path); }) };
  return { objects, provider };
}

it('uses native local storage wildcard capabilities and still rejects disallowed MIME types before writing', async () => {
  await diskFixture(async (f, root) => {
    const { LocalStorageProvider } = await import('../../../../../packages/storage/src/providers/LocalStorageProvider');
    const config = { type: 'local' as const, basePath: join(root, 'destination'), maxFileSize: 1024 ** 3, allowedMimeTypes: ['*/*'], retentionDays: 30 };
    const prepared = f.prepare();
    for (const allowedMimeTypes of [['*/*'], ['application/*'], ['application/octet-stream']]) {
      const provider = new LocalStorageProvider({ ...config, allowedMimeTypes });
      const lease = await stageCoManagedPortableWorkspaceFiles(prepared, provider);
      for (const row of lease.externalFiles) {
        const transfer = prepared.transfers.find(file => file.fileId === row.file_id)!;
        expect((await provider.download(String(row.storage_path))).equals(f.bytes.get(transfer.id)!)).toBe(true);
      }
      await lease.dispose();
      for (const row of lease.externalFiles) expect(await provider.exists(String(row.storage_path))).toBe(false);
    }
    for (const allowedMimeTypes of [[], ['image/*'], ['application/pdf']]) {
      const provider = new LocalStorageProvider({ ...config, allowedMimeTypes }), upload = vi.spyOn(provider, 'upload');
      await expect(stageCoManagedPortableWorkspaceFiles(prepared, provider)).rejects.toThrow('storage capabilities');
      expect(upload).not.toHaveBeenCalled();
    }
  });
});

it('binds recovery identity to the actual native storage location and tolerates credential rotation', async () => {
  await diskFixture(async (_f, root) => {
    const { LocalStorageProvider } = await import('../../../../../packages/storage/src/providers/LocalStorageProvider');
    const { S3StorageProvider } = await import('../../../../../packages/storage/src/providers/S3StorageProvider');
    const local = { type: 'local' as const, basePath: join(root, 'destination'), maxFileSize: 1024, allowedMimeTypes: ['*/*'], retentionDays: 30 };
    const provider = new LocalStorageProvider(local), identity = provider.getLocationIdentity();
    expect(identity).toMatch(/^[a-f0-9]{64}$/);
    expect(new LocalStorageProvider({ ...local, maxFileSize: 2048 }).getLocationIdentity()).toBe(identity);
    expect(new LocalStorageProvider({ ...local, basePath: join(root, 'other') }).getLocationIdentity()).not.toBe(identity);
    local.basePath = join(root, 'changed-after-construction');
    await provider.upload(Buffer.from('Bound location'), 'example.bin');
    expect((await readFile(join(root, 'destination', 'example.bin'))).toString()).toBe('Bound location');
    expect(provider.getLocationIdentity()).toBe(identity);
    const s3 = { type: 's3' as const, bucket: 'portable-test', region: 'us-east-1', endpoint: 'https://storage.example.test',
      accessKey: 'test-access', secretKey: 'test-secret', maxFileSize: 1024, allowedMimeTypes: ['*/*'], retentionDays: 30 };
    const original = new S3StorageProvider(s3).getLocationIdentity();
    expect(new S3StorageProvider({ ...s3, accessKey: 'rotated-access', secretKey: 'rotated-secret' }).getLocationIdentity()).toBe(original);
    expect(new S3StorageProvider({ ...s3, bucket: 'different-bucket' }).getLocationIdentity()).not.toBe(original);
    expect(new S3StorageProvider({ ...s3, endpoint: 'https://another.example.test' }).getLocationIdentity()).not.toBe(original);
  });
});

it('restores verified archive files through the actual S3 SDK HTTP stream and disposes only its uploaded keys', async () => {
  await diskFixture(async f => {
    const { createServer } = await import('node:http');
    const { S3StorageProvider } = await import('../../../../../packages/storage/src/providers/S3StorageProvider');
    const objects = new Map<string, { bytes: Buffer; mime: string }>(), errors: unknown[] = [];
    const server = createServer(async (request, response) => {
      try {
        const key = new URL(request.url!, 'http://fixture').pathname;
        if (request.method === 'PUT') {
          const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
          const body = Buffer.concat(chunks), decoded: Buffer[] = [];
          if (request.headers['content-encoding'] === 'aws-chunked') {
            let offset = 0;
            while (true) {
              const end = body.indexOf('\r\n', offset); if (end < 0) throw new Error('Missing chunk length');
              const size = Number.parseInt(body.subarray(offset, end).toString(), 16);
              if (!Number.isSafeInteger(size) || size < 0 || end + 2 + size > body.length) throw new Error('Invalid chunk length');
              if (!size) break;
              decoded.push(body.subarray(end + 2, end + 2 + size)); offset = end + 2 + size + 2;
            }
          } else decoded.push(body);
          const bytes = Buffer.concat(decoded);
          expect(bytes.length).toBe(Number(request.headers['x-amz-decoded-content-length'] ?? request.headers['content-length']));
          objects.set(key, { bytes, mime: String(request.headers['content-type']) });
        } else if (request.method === 'HEAD') {
          const object = objects.get(key)!; response.setHeader('Content-Length', object.bytes.length); response.setHeader('Content-Type', object.mime);
        } else if (request.method === 'DELETE') objects.delete(key);
        else throw new Error('Unexpected request');
        response.setHeader('ETag', '"fixture"'); response.end();
      } catch (error) { errors.push(error); response.statusCode = 400; response.end(); }
    });
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    try {
      const address = server.address() as import('node:net').AddressInfo;
      const provider = new S3StorageProvider({ type: 's3', region: 'us-east-1', bucket: 'fixture', accessKey: 'fixture', secretKey: 'fixture',
        endpoint: `http://127.0.0.1:${address.port}`, maxFileSize: 1024, allowedMimeTypes: ['application/*'], retentionDays: 30 });
      const prepared = f.prepare(), lease = await stageCoManagedPortableWorkspaceFiles(prepared, provider);
      expect(errors).toEqual([]); expect(objects.size).toBe(prepared.transfers.length);
      for (const row of lease.externalFiles) {
        const transfer = prepared.transfers.find(file => file.fileId === row.file_id)!;
        expect(objects.get(`/fixture/${row.storage_path}`)?.bytes).toEqual(f.bytes.get(transfer.id));
      }
      objects.set('/fixture/untouched', { bytes: Buffer.from('keep'), mime: 'text/plain' });
      await lease.dispose(); expect([...objects.keys()]).toEqual(['/fixture/untouched']);
    } finally { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  });
});

it('cancels a provider wait and removes a successful upload that returns after cancellation', async () => {
  await diskFixture(async f => {
    const { withPortableTransfer } = await import('../../../../../packages/co-managed/src/portableTransfer');
    const abort = new AbortController(), { provider, objects } = storage(), original = provider.upload.getMockImplementation()!;
    let finish!: () => void, late!: Promise<void>;
    const pending = new Promise<void>(resolve => { finish = resolve; });
    provider.upload.mockImplementation(async (...args) => {
      const result = await original(...args), bytes = objects.get(result.path)!;
      abort.abort();
      late = pending.then(() => { objects.set(result.path, bytes); });
      await late; return result;
    });
    await expect(withPortableTransfer({ signal: abort.signal }, () => stageCoManagedPortableWorkspaceFiles(f.prepare(), provider))).rejects.toThrow();
    expect(objects.size).toBe(0); finish(); await late;
    await vi.waitFor(() => { expect(provider.delete.mock.calls.length).toBeGreaterThanOrEqual(2); expect(objects.size).toBe(0); });
  });
});

it('opens an authenticated archive, streams verified bytes to unique destination keys and releases ownership after caller commit', async () => {
  await diskFixture(async (f, root) => {
    const archiveContext = { packageId: context.packageId, sourceTenant: context.sourceTenant };
    const archive = await sealPortableArchive({ context: archiveContext, manifest: f.manifest, files: f.files }, 'customer portable test passphrase');
    const opened = await openPortableArchive(archive.path, 'customer portable test passphrase', archiveContext);
    try {
      const prepared = prepareCoManagedPortableWorkspaceFiles({ manifest: opened.manifest, files: opened.files, preparedRecords: f.preparedRecords, importedByUserId });
      const { provider, objects } = storage(), lease = await stageCoManagedPortableWorkspaceFiles(prepared, provider);
      for (const row of lease.externalFiles) {
        const transfer = prepared.transfers.find(file => file.fileId === row.file_id)!;
        expect(objects.get(String(row.storage_path))!.equals(f.bytes.get(transfer.id)!)).toBe(true);
        expect(String(row.storage_path)).toMatch(new RegExp(`^${destinationTenant}/portable-restores/[a-f0-9-]+/[a-f0-9-]+$`));
        expect((row.metadata as any).portable_restore.sha256).toBe(transfer.sha256);
      }
      expect(JSON.stringify(lease.externalFiles)).not.toContain(root);
      lease.release(); await lease.dispose(); expect(objects.size).toBe(8); expect(provider.delete).not.toHaveBeenCalled();
    } finally { await opened.dispose(); await archive.dispose(); }
  });
});

it('cleans only attempt-owned provider objects on rollback or partial upload failure', async () => {
  await diskFixture(async f => {
    const { provider, objects } = storage(); objects.set('existing/customer/file', Buffer.from('existing'));
    const prepared = f.prepare(), lease = await stageCoManagedPortableWorkspaceFiles(prepared, provider);
    await lease.dispose(); await lease.dispose(); expect([...objects.keys()]).toEqual(['existing/customer/file']);
    const original = provider.upload.getMockImplementation()!; let calls = 0;
    provider.upload.mockImplementation(async (...args) => { const result = await original(...args); if (++calls === 2) throw new Error('Provider upload failed after storing bytes'); return result; });
    await expect(stageCoManagedPortableWorkspaceFiles(prepared, provider)).rejects.toThrow('Provider upload failed');
    expect([...objects.keys()]).toEqual(['existing/customer/file']);
  });
});

it('rejects corrupted or symlink local staging before provider writes and rejects dishonest upload receipts', async () => {
  await diskFixture(async (f, root) => {
    const { provider, objects } = storage(), prepared = f.prepare();
    const original = await readFile(prepared.transfers[1].path);
    await writeFile(prepared.transfers[1].path, Buffer.alloc(original.length, 1));
    await expect(stageCoManagedPortableWorkspaceFiles(prepared, provider)).rejects.toThrow(); expect(provider.upload).not.toHaveBeenCalled();
    await writeFile(prepared.transfers[1].path, original);
    const link = join(root, 'link'); await symlink(prepared.transfers[1].path, link); prepared.transfers[1].path = link;
    await expect(stageCoManagedPortableWorkspaceFiles(prepared, provider)).rejects.toThrow(); expect(provider.upload).not.toHaveBeenCalled();
    prepared.transfers[1].path = f.files[1].path;
    const originalUpload = provider.upload.getMockImplementation()!;
    provider.upload.mockImplementation(async (...args) => ({ ...await originalUpload(...args), size: 999 }));
    await expect(stageCoManagedPortableWorkspaceFiles(prepared, provider)).rejects.toThrow(); expect(objects.size).toBe(0);
  });
});
