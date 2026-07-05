import { revalidatePath } from 'next/cache';
import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import { isEnterprise } from '@alga-psa/core/features';
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
  isEnterpriseEdition?: () => boolean;
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

// EE Microsoft Graph access (fetching artifacts, downloading recording blobs) is injected
// by the caller via `dependencies` so this clients-layer orchestrator never imports the
// EE Teams package directly. Callers that need real capture (the proactive webhook handler
// and the cross-feature refresh action) supply `fetchArtifacts` / `downloadRecording`;
// when they are not provided (e.g. CE, where the edition gate short-circuits anyway) the
// defaults are no-ops.
async function noopFetchArtifacts(): Promise<TeamsMeetingArtifactPayload[]> {
  return [];
}

async function noopDownloadRecording(): Promise<string | null> {
  return null;
}

async function loadCaptureSettings(tenantId: string): Promise<CaptureSettings> {
  const { knex } = await createTenantKnex(tenantId);
  try {
    const row = await tenantDb(knex, tenantId).table('teams_integrations')
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
  const row = await tenantDb(knex, tenantId).table('interactions')
    .where({ interaction_id: meeting.interaction_id })
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
    await tenantDb(trx, input.tenantId).table('documents').insert({
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

    await tenantDb(trx, input.tenantId).table('document_block_content').insert({
      content_id: contentId,
      document_id: documentId,
      block_data: JSON.stringify(transcriptBlockData(input.artifact.transcriptContent ?? '')),
      tenant: input.tenantId,
      created_at: new Date(),
      updated_at: new Date(),
    });

    if (input.entity.clientId) {
      await tenantDb(trx, input.tenantId).table('document_associations').insert({
        association_id: uuidv4(),
        document_id: documentId,
        entity_id: input.entity.clientId,
        entity_type: 'client',
        tenant: input.tenantId,
        created_at: new Date(),
      });
    }

    if (input.entity.contactNameId) {
      await tenantDb(trx, input.tenantId).table('document_associations').insert({
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
  const isEnterpriseEdition = dependencies.isEnterpriseEdition ?? (() => isEnterprise);
  const fetchArtifacts = dependencies.fetchArtifacts ?? noopFetchArtifacts;
  const loadSettings = dependencies.loadSettings ?? loadCaptureSettings;
  const resolveMeetingEntity = dependencies.loadMeetingEntity ?? loadMeetingEntity;
  const persistTranscript = dependencies.createTranscriptDocument ?? createTranscriptDocument;
  const persistRecording = dependencies.downloadRecording ?? noopDownloadRecording;
  const revalidate = dependencies.revalidate ?? revalidateMeeting;
  const now = dependencies.now ?? (() => new Date());

  const meeting = await getMeeting(input.meetingId, input.tenantId);
  if (!meeting) {
    throw new Error('Online meeting not found');
  }
  if (meeting.status === 'cancelled') {
    return meeting;
  }
  if (!isEnterpriseEdition()) {
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
