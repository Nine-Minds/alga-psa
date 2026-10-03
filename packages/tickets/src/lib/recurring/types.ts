import type { RecurrenceRule, NonBusinessDayPolicy } from '@alga-psa/shared/lib/recurrence';
import type { RecurringTicketOverrides } from './effectiveFields';
import type { OpenPreviousPolicy, RecurringOccurrenceStatus } from './definitionInput';

/** Result shapes of the recurring-ticket actions. Dates are ISO strings (or `YYYY-MM-DD`) so they cross the server boundary. */

export type RecurringDefinitionStatus = 'active' | 'paused' | 'archived';

export interface RecurringDefinitionListItem {
  definition_id: string;
  name: string;
  status: RecurringDefinitionStatus;
  recurrence: RecurrenceRule;
  client_count: number;
  /** Earliest upcoming due instant across the definition's active clients, or null when none is scheduled. */
  next_due_at: string | null;
  /** The latest occurrence of any client of this definition is `failed`. */
  has_failure: boolean;
}

export interface RecurringDefinitionRecord {
  definition_id: string;
  name: string;
  is_active: boolean;
  archived_at: string | null;
  title_template: string;
  description: Record<string, unknown>[] | null;
  board_id: string;
  status_id: string | null;
  priority_id: string;
  category_id: string | null;
  subcategory_id: string | null;
  assigned_to: string | null;
  assigned_team_id: string | null;
  additional_agent_ids: string[];
  tags: string[];
  checklist_template_id: string | null;
  recurrence: RecurrenceRule;
  start_date: string;
  create_time: string;
  due_time: string;
  lead_days: number;
  non_business_day_policy: NonBusinessDayPolicy;
  open_previous_policy: OpenPreviousPolicy;
  notify_client_on_create: boolean;
}

export interface RecurringDefinitionClientRecord {
  definition_client_id: string;
  definition_id: string;
  client_id: string;
  client_name: string;
  is_active: boolean;
  overrides: RecurringTicketOverrides;
  contact_id: string | null;
  location_id: string | null;
  asset_ids: string[];
}

export interface RecurringDefinitionDetail {
  definition: RecurringDefinitionRecord;
  clients: RecurringDefinitionClientRecord[];
  /** Earliest upcoming due instant, shown per client row (the schedule is shared). */
  next_due_at: string | null;
}

export interface RecurringOccurrenceListItem {
  occurrence_id: string;
  definition_id: string;
  definition_client_id: string;
  client_id: string;
  client_name: string | null;
  occurrence_date: string;
  due_date: string;
  create_at: string | null;
  due_at: string | null;
  status: RecurringOccurrenceStatus;
  ticket_id: string | null;
  ticket_number: string | null;
  reason: string | null;
  attempts: number;
}

export interface RecurringOccurrencePage {
  items: RecurringOccurrenceListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface RecurringSchedulePreview {
  occurrences: { nominal: string; due: string; create_at: string; due_at: string }[];
  time_zone: string;
  /** Which business-day calendar adjusted the dates; null when the policy is `keep`. */
  calendar: { source: 'default_schedule' | 'fallback'; schedule_name: string | null } | null;
}

export interface RecurringTicketForClient {
  definition_client_id: string;
  definition_id: string;
  name: string;
  status: RecurringDefinitionStatus;
  is_client_active: boolean;
  recurrence: RecurrenceRule;
  next_due_at: string | null;
  overrides: RecurringTicketOverrides;
  contact_id: string | null;
  location_id: string | null;
  asset_ids: string[];
}

export interface RecurringTicketSource {
  definition_id: string;
  name: string;
}
