export type StopwatchSessionStatus = 'running' | 'paused' | 'logged' | 'discarded';

export interface StopwatchSegmentView {
  segment_id: string;
  /** ISO 8601 */
  started_at: string;
  /** ISO 8601, null = open */
  ended_at: string | null;
}

export interface StopwatchSessionView {
  session_id: string;
  user_id: string;
  /** `ticket` | `project_task` (legacy adapters may hold others) */
  work_item_type: string;
  work_item_id: string | null;
  service_id: string | null;
  notes: string;
  status: StopwatchSessionStatus;
  time_entry_id: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
  segments: StopwatchSegmentView[];
  /** Active milliseconds as of `server_now`. */
  active_ms: number;
  /** Server clock (ISO) at the moment this view was built; clients derive a clock offset from it. */
  server_now: string;
  // Display fields (names only; never raw ids)
  ticket_number: string | null;
  /** Ticket title or project task name */
  work_item_title: string | null;
  project_name: string | null;
  client_name: string | null;
  service_name: string | null;
}

export interface StartSessionInput {
  workItemType: string;
  workItemId: string | null;
  serviceId?: string | null;
  notes?: string;
}

export interface UpdateSessionDraftInput {
  /** undefined = unchanged */
  notes?: string;
  /** undefined = unchanged, null = clear */
  serviceId?: string | null;
}

/**
 * Overrides applied on top of the values derived from the session (toEntrySpan). Caller values win.
 * saveTimeEntry passes the whole drawer entry through this shape.
 */
export interface LogSessionInput {
  start_time?: string;
  end_time?: string;
  /** Minutes. When omitted it is derived from the final start/end span. */
  billable_duration?: number;
  /** false forces billable_duration to 0. */
  is_billable?: boolean;
  notes?: string;
  service_id?: string;
  contract_line_id?: string | null;
  tax_region?: string;
  tax_rate_id?: string | null;
  /** When given, no sheet resolution happens (the drawer already chose a sheet). */
  time_sheet_id?: string;
  work_item_id?: string;
  work_item_type?: string;
  /** Entry subject (delegation); defaults to the acting user. */
  user_id?: string;
}

export interface StopwatchOptions {
  /** Test/clock override. Defaults to the database clock. */
  now?: Date;
}

export interface StartSessionOptions extends StopwatchOptions {
  /** Legacy mobile adapter only: accept work item types other than ticket/project_task. */
  allowLegacyWorkItemTypes?: boolean;
}
