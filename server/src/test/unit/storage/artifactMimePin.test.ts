import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { uploadFile } = vi.hoisted(() => ({
  uploadFile: vi.fn(async (..._args: unknown[]) => ({ file_id: 'file-1' })),
}));

vi.mock('@alga-psa/storage/StorageService', () => ({
  StorageService: { uploadFile },
}));

vi.mock('@alga-psa/core/features', () => ({ isEnterprise: true }));

vi.mock('@alga-psa/ee-microsoft-teams/lib', () => ({
  fetchMeetingArtifacts: vi.fn(async () => []),
  resolveTeamsMeetingGraphConfig: vi.fn(async () => ({
    clientId: 'client',
    clientSecret: 'secret',
    microsoftTenantId: 'authority',
  })),
  fetchMicrosoftGraphAppToken: vi.fn(async () => 'graph-token'),
  fetchTeamsCallArtifacts: vi.fn(async () => []),
  downloadTeamsCallArtifactContent: vi.fn(async () => ({
    buffer: Buffer.from([1, 2, 3]),
    contentType: 'application/x-hostile-call; charset=utf-8',
  })),
  annotateLinkedTicketFromTranscript: vi.fn(async () => undefined),
}));

/**
 * Product-generated artifacts are stored with `origin: 'system-artifact'`,
 * which skips the user-upload MIME allowlist. These pin that a hostile or
 * unexpected provider `content-type` header is never persisted as the stored
 * artifact's MIME type: the type is stated in code.
 */
describe('generated artifact MIME is code-chosen', () => {
  beforeEach(() => {
    process.env.EDITION = 'enterprise';
    uploadFile.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('stores an online meeting recording as video/mp4 despite a hostile provider content-type', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(new Uint8Array([1, 2, 3]), {
            status: 200,
            headers: { 'content-type': 'application/x-hostile-recording; charset=utf-8' },
          })
      )
    );

    const { buildTeamsArtifactCaptureDeps } = await import(
      '../../../../../packages/scheduling/src/actions/onlineMeetingArtifactActions'
    );
    const deps = await buildTeamsArtifactCaptureDeps();
    await deps.downloadRecording({
      tenantId: 'tenant-1',
      actorUserId: 'user-1',
      meeting: { meeting_id: 'meeting-1', subject: 'Standup' },
      artifact: { providerArtifactId: 'artifact-1', contentUrl: 'https://graph.example/recording' },
    } as never);

    expect(uploadFile).toHaveBeenCalledTimes(1);
    const options = uploadFile.mock.calls[0][3] as Record<string, unknown>;
    expect(options.mime_type).toBe('video/mp4');
    expect(options.origin).toBe('system-artifact');
    expect(JSON.stringify(options)).not.toContain('application/x-hostile-recording');
  });

  it('stores a telephony call recording as video/mp4 despite a hostile provider content-type', async () => {
    const { buildTelephonyCallArtifactDeps } = await import(
      '../../../../../packages/jobs/src/lib/handlers/telephonyCallArtifactHandler'
    );
    const deps = await buildTelephonyCallArtifactDeps();
    expect(deps).not.toBeNull();

    await deps!.downloadRecording({
      tenantId: 'tenant-1',
      actorUserId: 'user-1',
      call: { call_record_id: 'call-1', provider_call_id: 'provider-call-1' },
      artifact: { providerArtifactId: 'artifact-1', contentUrl: 'https://graph.example/call' },
    } as never);

    expect(uploadFile).toHaveBeenCalledTimes(1);
    const options = uploadFile.mock.calls[0][3] as Record<string, unknown>;
    expect(options.mime_type).toBe('video/mp4');
    expect(options.origin).toBe('system-artifact');
    expect(JSON.stringify(options)).not.toContain('application/x-hostile-call');
  });
});
