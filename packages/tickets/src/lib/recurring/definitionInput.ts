import { z } from 'zod';
import {
  dateStringSchema,
  isValidTimeString,
  nonBusinessDayPolicySchema,
  recurrenceRuleSchema,
} from '@alga-psa/shared/lib/recurrence';
import { recurringTicketOverridesSchema } from './effectiveFields';

/**
 * Input schemas for the recurring-ticket actions (plan §4.9). Kept out of the `'use server'` module
 * because a server-action file may only export async functions, and the editor reuses them for
 * client-side checks.
 */
const uuid = z.string().guid();
const timeString = z.string().refine(isValidTimeString, 'Expected a time in HH:MM format');

export const OPEN_PREVIOUS_POLICIES = ['always_create', 'skip'] as const;
export type OpenPreviousPolicy = (typeof OPEN_PREVIOUS_POLICIES)[number];

/**
 * A recurring ticket definition is "when, for whom, how dispatched". What the ticket looks like is the
 * ticket template it points at (R1): the content fields (title, description, tags, checklist, ...)
 * are rejected here, not ignored. Board, priority and category can be overridden for this schedule.
 */
export const recurringTicketDefinitionInputSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(200),
    is_active: z.boolean().default(true),

    ticket_template_id: uuid,
    overrides: recurringTicketOverridesSchema.default({}),

    // Dispatch
    status_id: uuid.nullable().default(null),
    assigned_to: uuid.nullable().default(null),
    assigned_team_id: uuid.nullable().default(null),
    additional_agent_ids: z.array(uuid).default([]),

    recurrence: recurrenceRuleSchema,
    start_date: dateStringSchema,
    create_time: timeString.default('08:00'),
    due_time: timeString.default('17:00'),
    lead_days: z.number().int().min(0).max(365).default(0),
    non_business_day_policy: nonBusinessDayPolicySchema.default('keep'),

    open_previous_policy: z.enum(OPEN_PREVIOUS_POLICIES).default('always_create'),
    notify_client_on_create: z.boolean().default(false),
  })
  .strict();

export type RecurringTicketDefinitionInput = z.input<typeof recurringTicketDefinitionInputSchema>;
export type ParsedRecurringTicketDefinitionInput = z.output<typeof recurringTicketDefinitionInputSchema>;

/** Draft schedule used for the unsaved "next 5 due dates" preview. */
export const recurringSchedulePreviewInputSchema = z
  .object({
    /** When given, the preview also renders this template's title for the first occurrence. */
    ticket_template_id: uuid.nullable().optional(),
    /** Client name to render `{{client}}` with in the sample title. */
    sample_client_name: z.string().max(200).nullable().optional(),
    recurrence: recurrenceRuleSchema,
    start_date: dateStringSchema,
    create_time: timeString,
    due_time: timeString,
    lead_days: z.number().int().min(0).max(365),
    non_business_day_policy: nonBusinessDayPolicySchema,
  })
  .strict();

export type RecurringSchedulePreviewInput = z.infer<typeof recurringSchedulePreviewInputSchema>;

export const recurringTicketClientUpdateSchema = z
  .object({
    overrides: recurringTicketOverridesSchema,
    contact_id: uuid.nullable(),
    location_id: uuid.nullable(),
    asset_ids: z.array(uuid).max(500),
  })
  .strict();

export type RecurringTicketClientUpdate = z.infer<typeof recurringTicketClientUpdateSchema>;

export const RECURRING_OCCURRENCE_STATUSES = ['created', 'skipped', 'missed', 'failed'] as const;
export type RecurringOccurrenceStatus = (typeof RECURRING_OCCURRENCE_STATUSES)[number];

export const recurringOccurrenceFiltersSchema = z
  .object({
    status: z.enum(RECURRING_OCCURRENCE_STATUSES).optional(),
    clientId: uuid.optional(),
    page: z.number().int().min(1).default(1),
    pageSize: z.number().int().min(1).max(200).default(25),
  })
  .strict();

export type RecurringOccurrenceFilters = z.input<typeof recurringOccurrenceFiltersSchema>;
