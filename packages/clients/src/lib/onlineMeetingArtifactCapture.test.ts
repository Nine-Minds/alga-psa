/* @vitest-environment node */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { IOnlineMeeting, IOnlineMeetingArtifact } from '@alga-psa/types';
import { fetchAndPersistMeetingArtifacts } from './onlineMeetingArtifactCapture';

function meeting(overrides: Partial<IOnlineMeeting> = {}): IOnlineMeeting {
  const now = new Date('2026-06-01T10:00:00.000Z');
  return {
    tenant: 'tenant-1',
    meeting_id: 'meeting-1',
    provider: 'teams',
    provider_meeting_id: 'provider-meeting-1',
    provider_event_id: 'event-1',
    organizer_upn: 'organizer@example.com',
    organizer_user_id: 'organizer-user-1',
    subject: 'Support Review',
    join_url: 'https://teams.example/join',
    start_time: new Date('2026-06-01T09:00:00.000Z'),
    end_time: new Date('2026-06-01T09:30:00.000Z'),
    status: 'ended',
    recording_fetch_attempts: 0,
    last_fetch_at: null,
    appointment_request_id: null,
    interaction_id: 'interaction-1',
    schedule_entry_id: null,
    created_by: 'creator-1',
    created_at: now,
    updated_at: now,
    artifacts: [],
    ...overrides,
  };
}

function artifact(overrides: Partial<IOnlineMeetingArtifact> = {}): IOnlineMeetingArtifact {
  const now = new Date('2026-06-01T10:00:00.000Z');
  return {
    tenant: 'tenant-1',
    artifact_id: overrides.artifact_id ?? `artifact-${overrides.provider_artifact_id ?? '1'}`,
    meeting_id: 'meeting-1',
    artifact_type: 'recording',
    provider_artifact_id: 'recording-1',
    content_url: 'https://graph.example/recording',
    document_id: null,
    file_id: null,
    created_date_time: new Date('2026-06-01T09:35:00.000Z'),
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function createDeps(options: {
  currentMeeting?: IOnlineMeeting;
  artifacts?: IOnlineMeetingArtifact[];
  fetchedArtifacts?: Array<any>;
  downloadRecordings?: boolean;
  exposeRecordingsInPortal?: boolean;
  createTranscriptDocument?: ReturnType<typeof vi.fn>;
  downloadRecording?: ReturnType<typeof vi.fn>;
}) {
  const currentMeeting = options.currentMeeting ?? meeting();
  const artifacts = options.artifacts ?? [];
  const createTranscriptDocument = options.createTranscriptDocument ?? vi.fn(async () => 'doc-new');
  const downloadRecording = options.downloadRecording ?? vi.fn(async () => 'file-new');
  const updates: any[] = [];

  return {
    artifacts,
    updates,
    deps: {
      getMeeting: vi.fn(async () => ({ ...currentMeeting, artifacts })),
      listArtifacts: vi.fn(async () => artifacts),
      upsertArtifact: vi.fn(async (_meetingId: string, input: any) => {
        const existing = artifacts.find((row) =>
          row.artifact_type === input.artifact_type &&
          row.provider_artifact_id === input.provider_artifact_id,
        );
        if (existing) {
          Object.assign(existing, input, { updated_at: new Date('2026-06-01T11:00:00.000Z') });
          return existing;
        }
        const row = artifact({
          artifact_id: `artifact-${artifacts.length + 1}`,
          artifact_type: input.artifact_type,
          provider_artifact_id: input.provider_artifact_id,
          content_url: input.content_url,
          document_id: input.document_id,
          file_id: input.file_id,
          created_date_time: input.created_date_time,
        });
        artifacts.push(row);
        return row;
      }),
      updateMeeting: vi.fn(async (_meetingId: string, input: any) => {
        updates.push(input);
        return { ...currentMeeting, ...input, artifacts };
      }),
      isEnterpriseEdition: vi.fn(() => true),
      fetchArtifacts: vi.fn(async () => options.fetchedArtifacts ?? []),
      loadSettings: vi.fn(async () => ({
        downloadRecordings: options.downloadRecordings ?? false,
        exposeRecordingsInPortal: options.exposeRecordingsInPortal ?? false,
      })),
      loadMeetingEntity: vi.fn(async () => ({ clientId: 'client-1', contactNameId: 'contact-1' })),
      createTranscriptDocument,
      downloadRecording,
      revalidate: vi.fn(),
      now: () => new Date('2026-06-01T12:00:00.000Z'),
    },
  };
}

describe('online meeting artifact capture', () => {
  it('T052/T053/T059 upserts multiple recordings and transcripts idempotently and marks recording_ready', async () => {
    const harness = createDeps({
      fetchedArtifacts: [
        { artifactType: 'recording', providerArtifactId: 'rec-1', contentUrl: 'https://graph/rec-1', createdDateTime: '2026-06-01T09:35:00.000Z' },
        { artifactType: 'recording', providerArtifactId: 'rec-2', contentUrl: 'https://graph/rec-2', createdDateTime: '2026-06-01T09:36:00.000Z' },
        { artifactType: 'transcript', providerArtifactId: 'tr-1', contentUrl: 'https://graph/tr-1', createdDateTime: '2026-06-01T09:37:00.000Z', transcriptContent: 'WEBVTT tr1' },
        { artifactType: 'transcript', providerArtifactId: 'tr-2', contentUrl: 'https://graph/tr-2', createdDateTime: '2026-06-01T09:38:00.000Z', transcriptContent: 'WEBVTT tr2' },
      ],
    });

    await fetchAndPersistMeetingArtifacts({ tenantId: 'tenant-1', meetingId: 'meeting-1', actorUserId: 'actor-1' }, harness.deps as any);
    await fetchAndPersistMeetingArtifacts({ tenantId: 'tenant-1', meetingId: 'meeting-1', actorUserId: 'actor-1' }, harness.deps as any);

    expect(harness.artifacts).toHaveLength(4);
    expect(harness.artifacts.map((row) => `${row.artifact_type}:${row.provider_artifact_id}`).sort()).toEqual([
      'recording:rec-1',
      'recording:rec-2',
      'transcript:tr-1',
      'transcript:tr-2',
    ]);
    expect(harness.updates.at(-1)).toMatchObject({ status: 'recording_ready' });
  });

  it('T054/T055/T056 stores transcript documents with explicit user/entity metadata and portal visibility setting', async () => {
    const createTranscriptDocument = vi.fn(async () => 'doc-visible');
    const harness = createDeps({
      exposeRecordingsInPortal: true,
      createTranscriptDocument,
      fetchedArtifacts: [
        { artifactType: 'transcript', providerArtifactId: 'tr-1', contentUrl: null, createdDateTime: null, transcriptContent: 'WEBVTT' },
      ],
    });

    await fetchAndPersistMeetingArtifacts({ tenantId: 'tenant-1', meetingId: 'meeting-1', actorUserId: 'actor-1' }, harness.deps as any);

    expect(createTranscriptDocument).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1',
      actorUserId: 'actor-1',
      entity: { clientId: 'client-1', contactNameId: 'contact-1' },
      isClientVisible: true,
    }));

    const source = fs.readFileSync(path.resolve(__dirname, './onlineMeetingArtifactCapture.ts'), 'utf8');
    expect(source).not.toContain('uploadDocument');
    expect(source).toContain("tenantDb(trx, input.tenantId).table('documents').insert");
    expect(source).toContain("tenantDb(trx, input.tenantId).table('document_associations').insert");
    expect(source).toContain('is_client_visible: input.isClientVisible');
  });

  it('T057/T058 stores recording content_url and only downloads a file when download_recordings is enabled', async () => {
    const off = createDeps({
      downloadRecordings: false,
      fetchedArtifacts: [
        { artifactType: 'recording', providerArtifactId: 'rec-1', contentUrl: 'https://graph/rec-1', createdDateTime: null },
      ],
    });
    await fetchAndPersistMeetingArtifacts({ tenantId: 'tenant-1', meetingId: 'meeting-1', actorUserId: 'actor-1' }, off.deps as any);
    expect(off.deps.downloadRecording).not.toHaveBeenCalled();
    expect(off.artifacts[0]).toMatchObject({ content_url: 'https://graph/rec-1', file_id: null });

    const downloadRecording = vi.fn(async () => 'file-1');
    const on = createDeps({
      downloadRecordings: true,
      downloadRecording,
      fetchedArtifacts: [
        { artifactType: 'recording', providerArtifactId: 'rec-1', contentUrl: 'https://graph/rec-1', createdDateTime: null },
      ],
    });
    await fetchAndPersistMeetingArtifacts({ tenantId: 'tenant-1', meetingId: 'meeting-1', actorUserId: 'actor-1' }, on.deps as any);
    expect(downloadRecording).toHaveBeenCalledOnce();
    expect(on.artifacts[0]).toMatchObject({ content_url: 'https://graph/rec-1', file_id: 'file-1' });
  });

  it('T060 marks no_recording after the bounded retry cap with empty artifact results', async () => {
    const harness = createDeps({
      currentMeeting: meeting({ recording_fetch_attempts: 2 }),
      fetchedArtifacts: [],
    });

    await fetchAndPersistMeetingArtifacts({ tenantId: 'tenant-1', meetingId: 'meeting-1', actorUserId: 'actor-1' }, harness.deps as any);

    expect(harness.updates.at(-1)).toMatchObject({
      status: 'no_recording',
      recording_fetch_attempts: 3,
    });
  });

  it('T061 does not create a second transcript document when the artifact already has document_id', async () => {
    const createTranscriptDocument = vi.fn(async () => 'doc-new');
    const harness = createDeps({
      createTranscriptDocument,
      artifacts: [artifact({
        artifact_type: 'transcript',
        provider_artifact_id: 'tr-1',
        content_url: null,
        document_id: 'doc-existing',
      })],
      fetchedArtifacts: [
        { artifactType: 'transcript', providerArtifactId: 'tr-1', contentUrl: null, createdDateTime: null, transcriptContent: 'WEBVTT' },
      ],
    });

    await fetchAndPersistMeetingArtifacts({ tenantId: 'tenant-1', meetingId: 'meeting-1', actorUserId: 'actor-1' }, harness.deps as any);

    expect(createTranscriptDocument).not.toHaveBeenCalled();
    expect(harness.artifacts).toHaveLength(1);
    expect(harness.artifacts[0].document_id).toBe('doc-existing');
  });

  it('T062 refreshMeetingRecordings invokes the shared capture handler with EE deps injected from the composition layer', () => {
    // refreshMeetingRecordings lives in @alga-psa/scheduling (it needs EE Graph access), and
    // injects the capture deps so the clients orchestrator never depends on ee-microsoft-teams.
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../../scheduling/src/actions/onlineMeetingArtifactActions.ts'),
      'utf8',
    );

    expect(source).toContain('refreshMeetingRecordings');
    expect(source).toContain('fetchAndPersistMeetingArtifacts');
    expect(source).toContain('actorUserId: user.user_id');
    expect(source).toContain('buildTeamsArtifactCaptureDeps');
  });

  it('T077 does not fetch or mutate artifacts when Enterprise capture is disabled', async () => {
    const harness = createDeps({
      fetchedArtifacts: [
        { artifactType: 'recording', providerArtifactId: 'rec-1', contentUrl: 'https://graph/rec-1', createdDateTime: null },
        { artifactType: 'transcript', providerArtifactId: 'tr-1', contentUrl: null, createdDateTime: null, transcriptContent: 'WEBVTT' },
      ],
    });

    const result = await fetchAndPersistMeetingArtifacts(
      { tenantId: 'tenant-1', meetingId: 'meeting-1', actorUserId: 'actor-1' },
      {
        ...harness.deps,
        isEnterpriseEdition: () => false,
      } as any,
    );

    expect(result.meeting_id).toBe('meeting-1');
    expect(harness.deps.fetchArtifacts).not.toHaveBeenCalled();
    expect(harness.deps.loadSettings).not.toHaveBeenCalled();
    expect(harness.deps.upsertArtifact).not.toHaveBeenCalled();
    expect(harness.deps.updateMeeting).not.toHaveBeenCalled();
    expect(harness.artifacts).toHaveLength(0);
  });
});
