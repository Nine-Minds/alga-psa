import { randomUUID, createHash } from 'node:crypto';
import type { Knex } from 'knex';
import { expect, it, vi } from 'vitest';
import * as meetingConfig from '../../../../ee/packages/microsoft-teams/src/lib/meetings/meetingConfig';
import { exportCoManagedPortableRemoteMeetingFiles } from '../../../../ee/server/src/lib/co-managed/portableRemoteMeetingExport';

export function registerCoManagedPortableRemoteMeetingCases(getDb: () => Knex, withMeetingCreationFixture: (work: (fixture: any) => Promise<void>) => Promise<void>) {
  const fixture = async (work: (f: any) => Promise<void>) => withMeetingCreationFixture(async f => {
    await f.create();
    const operation = await f.operation(), db = getDb(), tenant = f.context.tenant, userId = f.context.userId;
    const actor = { kind: 'session' as const, tenant, userId, sessionId: randomUUID() }, profileId = randomUUID();
    await f.customer.table('sessions').insert({ tenant, session_id: actor.sessionId, user_id: userId, expires_at: new Date(Date.now() + 3600000) });
    await f.customer.table('microsoft_profiles').insert({ tenant, profile_id: profileId, display_name: 'Portable Graph', display_name_normalized: 'portable graph',
      client_id: 'portable-graph-client', tenant_id: f.target.microsoftTenantId, client_secret_ref: 'portable-test-graph-secret' });
    await f.customer.table('teams_integrations').insert({ tenant, selected_profile_id: profileId, install_status: 'active' });
    const artifactIds = [randomUUID(), randomUUID()], localId = randomUUID(), documentId = randomUUID();
    await f.customer.table('documents').insert({ tenant, document_id: documentId, document_name: 'Local transcript', created_by: userId, user_id: userId });
    await f.customer.table('document_block_content').insert({ tenant, content_id: randomUUID(), document_id: documentId, block_data: JSON.stringify([{ type: 'paragraph', content: [{ type: 'text', text: 'Already native transcript' }] }]) });
    await f.customer.table('online_meeting_artifacts').insert([
      ...artifactIds.map((id, index) => ({ tenant, artifact_id: id, meeting_id: operation.meeting_id, artifact_type: index ? 'transcript' : 'recording',
        provider_artifact_id: `qualified-artifact-${index}`, content_url: 'https://attacker.invalid/never-fetch-stored-url' })),
      { tenant, artifact_id: localId, meeting_id: operation.meeting_id, artifact_type: 'transcript', provider_artifact_id: 'local-transcript', document_id: documentId },
    ]);
    const fs = await import('node:fs/promises'), os = await import('node:os'), path = await import('node:path');
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'co-managed-remote-test-')), previousTmp = process.env.TMPDIR, realFetch = globalThis.fetch;
    process.env.TMPDIR = root;
    const config = { organizerUpn: 'different-current-organizer@example.invalid', organizerUserId: 'different-current-organizer', clientId: 'portable-graph-client', clientSecret: 'fake-remote-test-secret', microsoftTenantId: f.target.microsoftTenantId, sendMeetingInvites: false };
    const resolve = vi.spyOn(meetingConfig, 'resolveTeamsMeetingGraphConfig').mockImplementation(async actual => { expect(actual).toBe(tenant); return { ...config }; });
    const recording = Buffer.from('Remote recording bytes\u0000'), transcript = Buffer.from('WEBVTT\n\n00:00.000 --> 00:01.000\nCustomer transcript\n');
    const graph = vi.fn(async (url: string) => url.includes('/transcripts/') ? new Response(transcript) : new Response(recording, { headers: { 'content-length': String(recording.length) } }));
    const fetcher = vi.fn(async (input: any, options: any) => {
      const url = String(input); expect(options.redirect).toBe('error');
      if (url.includes('/oauth2/v2.0/token')) {
        expect(new URL(url).hostname).toBe('login.microsoftonline.com');
        expect(options.body.get('client_id')).toBe(config.clientId);
        return new Response(JSON.stringify({ access_token: 'fake-graph-bearer' }), { headers: { 'content-type': 'application/json' } });
      }
      expect(new URL(url).hostname).toBe('graph.microsoft.com'); expect(options.headers.Authorization).toBe('Bearer fake-graph-bearer');
      expect(url).toContain(`/users/${encodeURIComponent(f.target.organizerUserId)}/onlineMeetings/${encodeURIComponent(f.meeting.meetingId)}/`);
      return graph(url);
    });
    globalThis.fetch = fetcher as any;
    try { await work({ ...f, db, fs, root, actor, profileId, artifactIds, localId, config, graph, fetcher, recording, transcript, operation,
      exportFiles: () => exportCoManagedPortableRemoteMeetingFiles(db, actor, randomUUID()) }); }
    finally { globalThis.fetch = realFetch; resolve.mockRestore(); if (previousTmp === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = previousTmp; await fs.rm(root, { recursive: true, force: true }); }
  });

  it('portable remote meeting files capture real bounded Graph response streams from retained original identities only', async () => fixture(async f => {
    const lease = await f.exportFiles();
    try {
      expect(lease.files).toHaveLength(2); expect(f.graph).toHaveBeenCalledTimes(2);
      for (const file of lease.files) {
        const index = f.artifactIds.indexOf(file.id.split(':')[1]), expected = index ? f.transcript : f.recording;
        expect(await f.fs.readFile(file.path)).toEqual(expected); expect((await f.fs.stat(file.path)).mode & 0o777).toBe(0o600);
        expect(file.sha256).toBe(createHash('sha256').update(expected).digest('hex'));
      }
      expect(lease.component.fileBindings).toEqual(expect.arrayContaining(f.artifactIds.map((id: string) => ({ table: 'online_meeting_artifacts', recordId: id, field: 'content', blobId: `meeting_artifact:${id}` }))));
      for (const excluded of ['fake-remote-test-secret', 'fake-graph-bearer', 'attacker.invalid', 'qualified-artifact-', 'organizerUserId', f.root, 'client_secret']) expect(JSON.stringify(lease.component)).not.toContain(excluded);
      const calls = f.fetcher.mock.calls.length;
      await f.db.transaction((trx: Knex.Transaction) => lease.assertCurrent(trx));
      expect(f.fetcher).toHaveBeenCalledTimes(calls);
      await f.customer.table('microsoft_profiles').where('profile_id', f.profileId).update({ is_archived: true });
      await expect(f.db.transaction((trx: Knex.Transaction) => lease.assertCurrent(trx))).rejects.toThrow();
      expect(f.fetcher).toHaveBeenCalledTimes(calls);
    } finally { await lease.dispose(); }
    expect(await f.fs.readdir(f.root)).toEqual([]);
  }));

  it('portable remote meeting files reject missing provider receipt and oversized or truncated responses without retained output', async () => fixture(async f => {
    await f.customer.table('online_meetings').where('meeting_id', f.operation.meeting_id).update({ provider_event_id: 'unqualified-event' });
    await expect(f.exportFiles()).rejects.toThrow('Portable meeting artifact could not be captured'); expect(f.fetcher).not.toHaveBeenCalled();
    await f.customer.table('online_meetings').where('meeting_id', f.operation.meeting_id).update({ provider_event_id: f.meeting.eventId });
    f.graph.mockImplementation(async () => new Response('x', { headers: { 'content-length': String(64 * 1024 ** 3 + 1) } }));
    await expect(f.exportFiles()).rejects.toThrow('Portable meeting artifact could not be captured'); expect(await f.fs.readdir(f.root)).toEqual([]);
    f.graph.mockImplementation(async () => new Response('x', { headers: { 'content-length': '2' } }));
    await expect(f.exportFiles()).rejects.toThrow('Portable meeting artifact could not be captured'); expect(await f.fs.readdir(f.root)).toEqual([]);
    f.graph.mockImplementation(async () => new Response(null, { status: 302, headers: { location: 'https://attacker.invalid' } }));
    await expect(f.exportFiles()).rejects.toThrow('Portable meeting artifact could not be captured'); expect(await f.fs.readdir(f.root)).toEqual([]);
  }));

  it('portable remote meeting files reject current provider configuration or session changes after the response stream', async () => fixture(async f => {
    f.graph.mockImplementationOnce(async () => { f.config.clientSecret = 'rotated-provider-secret'; return new Response('bytes'); });
    await expect(f.exportFiles()).rejects.toThrow('Portable meeting artifact could not be captured'); expect(await f.fs.readdir(f.root)).toEqual([]);
    f.graph.mockImplementationOnce(async () => {
      await f.customer.table('sessions').where('session_id', f.actor.sessionId).update({ expires_at: new Date(Date.now() - 1000) });
      return new Response('bytes');
    });
    await expect(f.exportFiles()).rejects.toMatchObject({ code: 'CO_MANAGED_SHARED_WORK_FORBIDDEN' });
    expect(await f.fs.readdir(f.root)).toEqual([]);
  }));
}
