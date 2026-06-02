import { revalidatePath } from 'next/cache';
import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';
import { createTenantKnex, withTransaction } from '@alga-psa/db';
import { isEnterprise } from '@alga-psa/core/features';
import { StorageService } from '@alga-psa/storage/StorageService';
import type { IOnlineMeeting, IOnlineMeetingArtifact, OnlineMeetingArtifactType } from '@alga-psa/types';
import OnlineMeetingModel from '../models/onlineMeeting';

const RECORDING_FETCH_ATTEMPT_CAP = 3;

interface TeamsMeetingArtifactPayload {
  artifactType: OnlineMeetingArtifactType;
  providerArtifactId: string;
  contentUrl: string | null;
  createdDateTime: string | null;
  transcriptContent?: string;
}

interface CaptureSettings {
  downloadRecordings: boolean;
  exposeRecordingsInPortal: boolean;
}

export interface MeetingEntity {
  clientId: string | null;
  contactNameId: string | null;
}

export interface FetchAndPersistMeetingArtifactsInput {
  tenantId: string;
  meetingId: string;
  actorUserId?: string | null;
}

export interface FetchAndPersistMeetingArtifactsDependencies {
  getMeeting?: typeof OnlineMeetingModel.getById;
  listArtifacts?: typeof OnlineMeetingModel.listArtifacts;
  upsertArtifact?: typeof OnlineMeetingModel.upsertArtifact;
  updateMeeting?: typeof OnlineMeetingModel.update;
  fetchArtifacts?: (input: { tenantId: string; meetingId: string; organizerUserId: string }) => Promise<TeamsMeetingArtifactPayload[]>;
  loadSettings?: (tenantId: string) => Promise<CaptureSettings>;
  loadMeetingEntity?: (tenantId: string, meeting: IOnlineMeeting) => Promise<MeetingEntity>;
  createTranscriptDocument?: (input: CreateTranscriptDocumentInput) => Promise<string>;
  downloadRecording?: (input: DownloadRecordingInput) => Promise<string | null>;
  revalidate?: (meeting: IOnlineMeeting, entity: MeetingEntity) => void;
  now?: () => Date;
}

export interface CreateTranscriptDocumentInput {
  tenantId: string;
  meeting: IOnlineMeeting;
  entity: MeetingEntity;
  artifact: TeamsMeetingArtifactPayload;
  actorUserId: string;
  isClientVisible: boolean;
}

export interface DownloadRecordingInput {
  tenantId: string;
  meeting: IOnlineMeeting;
  artifact: TeamsMeetingArtifactPayload;
  actorUserId: string;
}

type EeTeamsMeetingModule = {
  fetchMeetingArtifacts?: (input: { tenantId: string; meetingId: string; organizerUserId: string }) => Promise<TeamsMeetingArtifactPayload[]>;
  resolveTeamsMeetingGraphConfig?: (tenantId: string) => Promise<{
    clientId: string;
    clientSecret: string;
    microsoftTenantId: string;
  } | null>;
  fetchMicrosoftGraphAppToken?: (input: {
    tenantAuthority: string;
    clientId: string;
    clientSecret: string;
  }) => Promise<string>;
};

async function loadEeTeamsMeetingModule(): Promise<EeTeamsMeetingModule> {
  if (!isEnterprise) {
    return {};
  }

  try {
    return (await import('@alga-psa/ee-microsoft-teams/lib')) as EeTeamsMeetingModule;
  } catch (error) {
    console.warn('[OnlineMeetingArtifactCapture] EE Teams module unavailable', error);
    return {};
  }
}

async function defaultFetchArtifacts(input: { tenantId: string; meetingId: string; organizerUserId: string }): Promise<TeamsMeetingArtifactPayload[]> {
  const ee = await loadEeTeamsMeetingModule();
  return ee.fetchMeetingArtifacts ? ee.fetchMeetingArtifacts(input) : [];
}

async function loadCaptureSettings(tenantId: string): Promise<CaptureSettings> {
  const { knex } = await createTenantKnex(tenantId);
  try {
    const row = await knex('teams_integrations')
      .where({ tenant: tenantId })
      .first('download_recordings', 'expose_recordings_in_portal');

    return {
      downloadRecordings: row?.download_recordings === true,
      exposeRecordingsInPortal: row?.expose_recordings_in_portal === true,
    };
  } catch (error) {
    return {
      downloadRecordings: false,
      exposeRecordingsInPortal: false,
    };
  }
}

async function loadMeetingEntity(tenantId: string, meeting: IOnlineMeeting): Promise<MeetingEntity> {
  if (!meeting.interaction_id) {
    return { clientId: null, contactNameId: null };
  }

  const { knex } = await createTenantKnex(tenantId);
  const row = await knex('interactions')
    .where({ tenant: tenantId, interaction_id: meeting.interaction_id })
    .first('client_id', 'contact_name_id');

  return {
    clientId: row?.client_id ?? null,
    contactNameId: row?.contact_name_id ?? null,
  };
}

function resolveActorUserId(meeting: IOnlineMeeting, actorUserId?: string | null): string {
  const userId = actorUserId || meeting.created_by;
  if (!userId) {
    throw new Error('A user id is required to persist online meeting artifacts');
  }
  return userId;
}

function transcriptBlockData(content: string) {
  return [
    {
      type: 'paragraph',
      props: { textAlignment: 'left', backgroundColor: 'default', textColor: 'default' },
      content: [{ type: 'text', text: content, styles: {} }],
    },
  ];
}

export async function createTranscriptDocument(input: CreateTranscriptDocumentInput): Promise<string> {
  const { knex } = await createTenantKnex(input.tenantId);
  const documentId = uuidv4();
  const contentId = uuidv4();
  const documentName = `Transcript - ${input.meeting.subject}`;

  await withTransaction(knex, async (trx: Knex.Transaction) => {
    await trx('documents').insert({
      document_id: documentId,
      document_name: documentName,
      user_id: input.actorUserId,
      created_by: input.actorUserId,
      tenant: input.tenantId,
      type_id: null,
      order_number: 0,
      is_client_visible: input.isClientVisible,
      entered_at: new Date(),
      updated_at: new Date(),
    });

    await trx('document_block_content').insert({
      content_id: contentId,
      document_id: documentId,
      block_data: JSON.stringify(transcriptBlockData(input.artifact.transcriptContent ?? '')),
      tenant: input.tenantId,
      created_at: new Date(),
      updated_at: new Date(),
    });

    if (input.entity.clientId) {
      await trx('document_associations').insert({
        association_id: uuidv4(),
        document_id: documentId,
        entity_id: input.entity.clientId,
        entity_type: 'client',
        tenant: input.tenantId,
        created_at: new Date(),
      });
    }

    if (input.entity.contactNameId) {
      await trx('document_associations').insert({
        association_id: uuidv4(),
        document_id: documentId,
        entity_id: input.entity.contactNameId,
        entity_type: 'contact',
        tenant: input.tenantId,
        created_at: new Date(),
      });
    }
  });

  return documentId;
}

export async function downloadRecordingToFileStore(input: DownloadRecordingInput): Promise<string | null> {
  if (!input.artifact.contentUrl) {
    return null;
  }

  const ee = await loadEeTeamsMeetingModule();
  if (!ee.resolveTeamsMeetingGraphConfig || !ee.fetchMicrosoftGraphAppToken) {
    return null;
  }

  const config = await ee.resolveTeamsMeetingGraphConfig(input.tenantId);
  if (!config) {
    return null;
  }

  const accessToken = await ee.fetchMicrosoftGraphAppToken({
    tenantAuthority: config.microsoftTenantId,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
  });
  const response = await fetch(input.artifact.contentUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to download Teams recording (${response.status})`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const file = await StorageService.uploadFile(input.tenantId, buffer, `${input.meeting.subject || 'teams-meeting'}-${input.artifact.providerArtifactId}.mp4`, {
    mime_type: response.headers.get('content-type') || 'video/mp4',
    uploaded_by_id: input.actorUserId,
    metadata: {
      source: 'teams_online_meeting_recording',
      meeting_id: input.meeting.meeting_id,
      provider_artifact_id: input.artifact.providerArtifactId,
    },
  });

  return file.file_id;
}

function findExistingArtifact(
  artifacts: IOnlineMeetingArtifact[],
  artifact: TeamsMeetingArtifactPayload,
): IOnlineMeetingArtifact | undefined {
  return artifacts.find((existing) =>
    existing.artifact_type === artifact.artifactType &&
    existing.provider_artifact_id === artifact.providerArtifactId,
  );
}

function revalidateMeeting(_meeting: IOnlineMeeting, entity: MeetingEntity): void {
  revalidatePath('/msp/interactions/[id]', 'page');
  if (entity.clientId) {
    revalidatePath('/msp/clients/[id]', 'page');
  }
  if (entity.contactNameId) {
    revalidatePath('/msp/contacts/[id]', 'page');
  }
}

export async function fetchAndPersistMeetingArtifacts(
  input: FetchAndPersistMeetingArtifactsInput,
  dependencies: FetchAndPersistMeetingArtifactsDependencies = {},
): Promise<IOnlineMeeting> {
  const getMeeting = dependencies.getMeeting ?? OnlineMeetingModel.getById.bind(OnlineMeetingModel);
  const listArtifacts = dependencies.listArtifacts ?? OnlineMeetingModel.listArtifacts.bind(OnlineMeetingModel);
  const upsertArtifact = dependencies.upsertArtifact ?? OnlineMeetingModel.upsertArtifact.bind(OnlineMeetingModel);
  const updateMeeting = dependencies.updateMeeting ?? OnlineMeetingModel.update.bind(OnlineMeetingModel);
  const fetchArtifacts = dependencies.fetchArtifacts ?? defaultFetchArtifacts;
  const loadSettings = dependencies.loadSettings ?? loadCaptureSettings;
  const resolveMeetingEntity = dependencies.loadMeetingEntity ?? loadMeetingEntity;
  const persistTranscript = dependencies.createTranscriptDocument ?? createTranscriptDocument;
  const persistRecording = dependencies.downloadRecording ?? downloadRecordingToFileStore;
  const revalidate = dependencies.revalidate ?? revalidateMeeting;
  const now = dependencies.now ?? (() => new Date());

  const meeting = await getMeeting(input.meetingId, input.tenantId);
  if (!meeting) {
    throw new Error('Online meeting not found');
  }
  if (meeting.status === 'cancelled') {
    return meeting;
  }
  if (!meeting.organizer_user_id) {
    const updated = await updateMeeting(meeting.meeting_id, {
      status: 'failed',
      last_fetch_at: now(),
    }, input.tenantId);
    return updated ?? meeting;
  }

  const actorUserId = resolveActorUserId(meeting, input.actorUserId);
  const [settings, entity, existingArtifacts, fetchedArtifacts] = await Promise.all([
    loadSettings(input.tenantId),
    resolveMeetingEntity(input.tenantId, meeting),
    listArtifacts(meeting.meeting_id, input.tenantId),
    fetchArtifacts({
      tenantId: input.tenantId,
      meetingId: meeting.provider_meeting_id,
      organizerUserId: meeting.organizer_user_id,
    }),
  ]);

  for (const artifact of fetchedArtifacts) {
    const existing = findExistingArtifact(existingArtifacts, artifact);
    let documentId = existing?.document_id ?? null;
    let fileId = existing?.file_id ?? null;

    if (artifact.artifactType === 'transcript' && artifact.transcriptContent && !documentId) {
      documentId = await persistTranscript({
        tenantId: input.tenantId,
        meeting,
        entity,
        artifact,
        actorUserId,
        isClientVisible: settings.exposeRecordingsInPortal,
      });
    }

    if (artifact.artifactType === 'recording' && settings.downloadRecordings && artifact.contentUrl && !fileId) {
      fileId = await persistRecording({
        tenantId: input.tenantId,
        meeting,
        artifact,
        actorUserId,
      });
    }

    await upsertArtifact(meeting.meeting_id, {
      artifact_type: artifact.artifactType,
      provider_artifact_id: artifact.providerArtifactId,
      content_url: artifact.contentUrl,
      document_id: documentId,
      file_id: fileId,
      created_date_time: artifact.createdDateTime ? new Date(artifact.createdDateTime) : null,
    }, input.tenantId);
  }

  const latestArtifacts = await listArtifacts(meeting.meeting_id, input.tenantId);
  const nextAttempts = (meeting.recording_fetch_attempts ?? 0) + 1;
  const nextStatus = latestArtifacts.length > 0
    ? 'recording_ready'
    : nextAttempts >= RECORDING_FETCH_ATTEMPT_CAP
      ? 'no_recording'
      : 'recording_pending';

  const updated = await updateMeeting(meeting.meeting_id, {
    status: nextStatus,
    recording_fetch_attempts: nextAttempts,
    last_fetch_at: now(),
  }, input.tenantId);

  const result = updated ?? await getMeeting(input.meetingId, input.tenantId) ?? meeting;
  revalidate(result, entity);
  return result;
}
