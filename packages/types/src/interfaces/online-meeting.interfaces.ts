import { TenantEntity } from '.';

export type OnlineMeetingProvider = 'teams' | string;

export type OnlineMeetingStatus =
  | 'scheduled'
  | 'ended'
  | 'recording_pending'
  | 'recording_ready'
  | 'no_recording'
  | 'cancel_pending'
  | 'cancelled'
  | 'failed';

export type OnlineMeetingArtifactType = 'recording' | 'transcript';

export interface IOnlineMeetingArtifact extends TenantEntity {
  artifact_id: string;
  meeting_id: string;
  artifact_type: OnlineMeetingArtifactType;
  provider_artifact_id: string;
  content_url: string | null;
  document_id: string | null;
  file_id: string | null;
  created_date_time: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface IOnlineMeeting extends TenantEntity {
  meeting_id: string;
  provider: OnlineMeetingProvider;
  /** Null for rows persisted after a failed Graph creation. */
  provider_meeting_id: string | null;
  provider_event_id: string | null;
  organizer_upn: string | null;
  organizer_user_id: string | null;
  subject: string;
  /** Null for rows persisted after a failed Graph creation. */
  join_url: string | null;
  start_time: Date;
  end_time: Date;
  status: OnlineMeetingStatus;
  /** Graph error code recorded for failed creation / cleanup outcomes. */
  error_code: string | null;
  recording_fetch_attempts: number;
  last_fetch_at: Date | null;
  appointment_request_id: string | null;
  interaction_id: string | null;
  schedule_entry_id: string | null;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
  artifacts: IOnlineMeetingArtifact[];
}

/** Public meeting projection. Provider/storage identities remain internal. */
export type IOnlineMeetingArtifactView = Pick<IOnlineMeetingArtifact, 'artifact_id' | 'artifact_type' | 'document_id' | 'created_date_time'> & { download_url?: string };
export type IOnlineMeetingView = Pick<IOnlineMeeting, 'tenant' | 'meeting_id' | 'provider' | 'subject' | 'join_url' | 'start_time' | 'end_time' | 'status' | 'appointment_request_id' | 'interaction_id' | 'schedule_entry_id' | 'created_at' | 'updated_at'> & { artifacts: IOnlineMeetingArtifactView[] };
