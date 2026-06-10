export type AppointmentStatus = 'pending' | 'approved' | 'declined' | 'cancelled';

export interface OnlineMeetingAppointmentArtifact {
  artifact_id: string;
  artifact_type: 'recording' | 'transcript';
  document_id: string | null;
  created_date_time?: string | Date | null;
}

/** Minimum fields required to render an appointment in lists/cards/calendar. */
export interface AppointmentSummary {
  appointment_request_id: string;
  service_name: string;
  requested_date: string;
  requested_time: string;
  requested_duration: number;
  requester_timezone?: string | null;
  status: AppointmentStatus;
  preferred_assigned_user_name?: string;
}

/** Full record returned by getMyAppointmentRequests. */
export interface AppointmentRequest extends AppointmentSummary {
  service_id: string;
  description?: string;
  ticket_id?: string;
  ticket_number?: string;
  approved_at?: string;
  declined_reason?: string;
  online_meeting_url?: string | null;
  online_meeting_artifacts?: OnlineMeetingAppointmentArtifact[];
  created_at: string;
}
