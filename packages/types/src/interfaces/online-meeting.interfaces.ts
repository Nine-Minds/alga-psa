import { TenantEntity } from '.';

export type OnlineMeetingProvider = 'teams' | string;

export type OnlineMeetingStatus =
  | 'scheduled'
  | 'ended'
  | 'recording_pending'
  | 'recording_ready'
  | 'no_recording'
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
  provider_meeting_id: string;
  provider_event_id: string | null;
  organizer_upn: string | null;
  organizer_user_id: string | null;
  subject: string;
  join_url: string;
  start_time: Date;
  end_time: Date;
  status: OnlineMeetingStatus;
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
