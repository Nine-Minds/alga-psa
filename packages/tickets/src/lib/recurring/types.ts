import type { RecurrenceRule, NonBusinessDayPolicy } from '@alga-psa/shared/lib/recurrence';
import type { RecurringTemplateFields, RecurringTicketOverrides } from './effectiveFields';
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
  /** Tenant timezone: due times are wall-clock in it, so the UI formats instants with it. */
  time_zone: string;
}

export interface RecurringTemplateSummary {
  template_id: string;
  name: string;
  title: string;
  is_active: boolean;
  offer_for_manual_use: boolean;
  board_id: string | null;
  priority_id: string | null;
  category_id: string | null;
  subcategory_id: string | null;
}

export interface RecurringDefinitionRecord {
  definition_id: string;
  name: string;
  is_active: boolean;
  archived_at: string | null;
  /** The shared ticket template this schedule instantiates live (R1). */
  ticket_template_id: string;
  /** Name and state of that template; null when the row is gone (the generator then fails each occurrence). */
  template: RecurringTemplateSummary | null;
  /** Overrides of the template for the whole schedule; client overrides layer on top. */
  overrides: RecurringTicketOverrides;
  status_id: string | null;
  assigned_to: string | null;
  assigned_team_id: string | null;
  additional_agent_ids: string[];
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
  time_zone: string;
  /** Template -> dispatch -> schedule overrides: what a client without its own overrides gets. */
  effective_fields: RecurringTemplateFields;
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
  /** The template's title rendered for the first occurrence (and the previewed client, when given); null without a template. */
  sample_title: string | null;
}

export interface RecurringTicketForClient {
  definition_client_id: string;
  definition_id: string;
  name: string;
  status: RecurringDefinitionStatus;
  is_client_active: boolean;
  recurrence: RecurrenceRule;
  next_due_at: string | null;
  time_zone: string;
  overrides: RecurringTicketOverrides;
  /** Template -> dispatch -> schedule overrides: what this client inherits, for the overrides dialog hints. */
  inherited_fields: RecurringTemplateFields;
  contact_id: string | null;
  location_id: string | null;
  asset_ids: string[];
}

export interface RecurringTicketSource {
  definition_id: string;
  name: string;
}
