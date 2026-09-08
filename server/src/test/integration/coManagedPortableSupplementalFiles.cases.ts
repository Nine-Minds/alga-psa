import { randomUUID, createHash } from 'node:crypto';
import type { Knex } from 'knex';
import { expect, it } from 'vitest';
import { Readable } from 'node:stream';
import { exportCoManagedPortableSupplementalFiles } from '../../../../packages/co-managed/src/portableSupplementalFileExport';

export function registerCoManagedPortableSupplementalFileCases(getDb: () => Knex, createFixture: () => Promise<any>, storage: { getReadStream: any }) {
  const fixture = async (work: (f: any) => Promise<void>) => {
    const f = await createFixture(), db = getDb(), tenant = f.actor.tenant, user = f.actor.userId;
    const fs = await import('node:fs/promises'), os = await import('node:os'), path = await import('node:path');
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'co-managed-supplemental-test-')), previousTmp = process.env.TMPDIR;
    process.env.TMPDIR = root;
    const fileId = randomUUID(), coveredId = randomUUID(), documentId = randomUUID(), typeId = randomUUID(), interactionId = randomUUID(), scheduleId = randomUUID(), meetingId = randomUUID();
    const artifactIds = [randomUUID(), randomUUID(), randomUUID()];
    const bytes = Buffer.from('Native standalone recording\u0000bytes'), coveredBytes = Buffer.from('Document-covered native recording');
    const nativePath = `/${tenant}/supplemental-${fileId}.mp4`, coveredPath = `/${tenant}/covered-${coveredId}.mp4`;
    try {
      await f.customer.table('interaction_types').insert({ tenant, type_id: typeId, type_name: `Supplemental meeting ${typeId}`, created_by: user });
      await f.customer.table('interactions').insert({ tenant, interaction_id: interactionId, type_id: typeId, user_id: user,
        client_id: f.operation.customer_client_id, ticket_id: f.resource.id, title: 'Customer recorded interaction' });
      await f.customer.table('schedule_entries').insert({ tenant, entry_id: scheduleId, title: 'Private customer meeting', work_item_id: interactionId, work_item_type: 'interaction',
        scheduled_start: '2026-09-08T13:00:00Z', scheduled_end: '2026-09-08T13:45:00Z', status: 'scheduled', is_private: true });
      await f.customer.table('schedule_entry_assignees').insert({ tenant, entry_id: scheduleId, user_id: user });
      await f.customer.table('online_meetings').insert({ tenant, meeting_id: meetingId, provider: 'teams', subject: 'Customer recorded meeting', status: 'ended',
        start_time: '2026-09-08T13:00:00Z', end_time: '2026-09-08T13:45:00Z', interaction_id: interactionId, schedule_entry_id: scheduleId, created_by: user });
      await f.customer.table('external_files').insert([{ tenant, file_id: fileId, file_name: 'standalone.mp4', original_name: 'standalone.mp4', mime_type: 'video/mp4',
        file_size: bytes.length, storage_path: nativePath, uploaded_by_id: user }, { tenant, file_id: coveredId, file_name: 'covered.mp4', original_name: 'covered.mp4', mime_type: 'video/mp4',
        file_size: coveredBytes.length, storage_path: coveredPath, uploaded_by_id: user }]);
      await f.customer.table('documents').insert({ tenant, document_id: documentId, document_name: 'Covered recording', file_id: coveredId, created_by: user, user_id: user });
      await f.customer.table('online_meeting_artifacts').insert(artifactIds.map((artifactId, index) => ({ tenant, artifact_id: artifactId, meeting_id: meetingId,
        artifact_type: 'recording', file_id: index === 2 ? coveredId : fileId, document_id: index === 1 ? documentId : null,
        provider_artifact_id: `never-portable-provider-${index}`, content_url: 'https://provider.invalid/never-portable-content' })));
      const objects = new Map([[nativePath, bytes], [coveredPath, coveredBytes]]);
      const stream = async (source: string) => { const value = objects.get(source); if (!value) throw new Error('Unexpected source'); return Readable.from([value]); };
      storage.getReadStream.mockReset().mockImplementation(stream);
      await work({ ...f, db, fs, root, fileId, coveredId, documentId, scheduleId, artifactIds, bytes, nativePath, coveredPath, stream,
        exportFiles: () => exportCoManagedPortableSupplementalFiles(db, f.customerPrincipal, randomUUID()) });
    } finally { storage.getReadStream.mockReset(); if (previousTmp === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = previousTmp; await fs.rm(root, { recursive: true, force: true }); }
  };

  it('portable supplemental files capture actual artifact-only bytes and deduplicate by document file identity', async () => fixture(async f => {
    const lease = await f.exportFiles();
    try {
      expect(lease.files).toHaveLength(1); expect(lease.files[0].id).toBe(`file:${f.fileId}`);
      expect(await f.fs.readFile(lease.files[0].path)).toEqual(f.bytes);
      expect((await f.fs.stat(lease.files[0].path)).mode & 0o777).toBe(0o600);
      expect(lease.component.blobs[0].sha256).toBe(createHash('sha256').update(f.bytes).digest('hex'));
      expect(lease.component.fileBindings).toHaveLength(3);
      expect(lease.component.fileBindings).toContainEqual({ table: 'online_meeting_artifacts', recordId: f.artifactIds[1], field: 'file_id', blobId: `file:${f.fileId}` });
      expect(lease.component.fileBindings).toContainEqual({ table: 'online_meeting_artifacts', recordId: f.artifactIds[2], field: 'file_id', blobId: `file:${f.coveredId}` });
      for (const excluded of [f.nativePath, f.coveredPath, f.root, 'never-portable-provider', 'content_url', 'storage_path']) expect(JSON.stringify(lease.component)).not.toContain(excluded);
      expect(storage.getReadStream).toHaveBeenCalledTimes(1);
    } finally { await lease.dispose(); }
    expect(await f.fs.readdir(f.root)).toEqual([]);
  }));

  it('portable supplemental files dispose truncated streams and reject foreign paths before provider access', async () => fixture(async f => {
    storage.getReadStream.mockImplementation(async () => Readable.from([Buffer.from('short')]));
    await expect(f.exportFiles()).rejects.toThrow('Portable export file could not be staged');
    expect(await f.fs.readdir(f.root)).toEqual([]);
    await f.customer.table('external_files').where('file_id', f.fileId).update({ storage_path: `/${f.principal.tenant}/foreign.mp4` });
    storage.getReadStream.mockClear().mockImplementation(f.stream);
    await expect(f.exportFiles()).rejects.toMatchObject({ code: 'CO_MANAGED_SHARED_WORK_FORBIDDEN' });
    expect(storage.getReadStream).not.toHaveBeenCalled();
    expect(await f.fs.readdir(f.root)).toEqual([]);
  }));

  it('portable supplemental files reject revoked private meeting access and changed document coverage after staging', async () => fixture(async f => {
    storage.getReadStream.mockImplementationOnce(async (source: string) => {
      await f.customer.table('schedule_entry_assignees').where('entry_id', f.scheduleId).delete();
      return f.stream(source);
    });
    await expect(f.exportFiles()).rejects.toMatchObject({ code: 'CO_MANAGED_SHARED_WORK_FORBIDDEN' });
    expect(await f.fs.readdir(f.root)).toEqual([]);
    await f.customer.table('schedule_entry_assignees').insert({ tenant: f.actor.tenant, entry_id: f.scheduleId, user_id: f.actor.userId });
    storage.getReadStream.mockImplementationOnce(async (source: string) => {
      await f.customer.table('documents').where('document_id', f.documentId).update({ file_id: f.fileId });
      return f.stream(source);
    });
    await expect(f.exportFiles()).rejects.toMatchObject({ code: 'CO_MANAGED_SHARED_WORK_FORBIDDEN' });
    expect(await f.fs.readdir(f.root)).toEqual([]);
  }));
}
