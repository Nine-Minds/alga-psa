/**
 * Wire shape of the server-side stopwatch (plan section 5). Lives in @alga-psa/types so that
 * packages/ui (StopwatchContext) and packages/tickets can type against it without importing
 * @alga-psa/scheduling, which owns the implementation.
 */

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

/** Mirrors StopwatchEntrySpan in scheduling's stopwatchMath (D5). */
export interface StopwatchEntrySpanView {
  /** First segment start truncated to the minute. */
  start: Date;
  /** start + billableMinutes. */
  end: Date;
  /** round(activeMs / 60000), minimum 1. */
  billableMinutes: number;
  /** Wall-clock time inside the session that was not active. */
  pausedMs: number;
  segmentCount: number;
}
