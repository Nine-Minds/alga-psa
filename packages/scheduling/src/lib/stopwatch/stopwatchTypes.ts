import type {
  StopwatchSegmentView,
  StopwatchSessionStatus,
  StopwatchSessionView,
} from '@alga-psa/types';

// The wire shape lives in @alga-psa/types so ui/tickets can use it without importing scheduling.
export type { StopwatchSegmentView, StopwatchSessionStatus, StopwatchSessionView };

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
