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
    name: z.string().trim().min(1, 'Name is required').max(200).describe('Name of the schedule, for example "Apple APNs certificate renewal". It is not the ticket title; the title comes from the ticket template.'),
    is_active: z.boolean().default(true).describe('Whether the schedule generates tickets. A definition only generates tickets for the clients added to it. Default true.'),

    ticket_template_id: uuid.describe('Ticket template this schedule creates tickets from: it supplies the title, description, checklist, tags and default board, priority and category. Create one with POST /api/v1/tickets/templates first.'),
    overrides: recurringTicketOverridesSchema.default({}).describe('Overrides of the template for the whole schedule: board, priority, category and assignment groups. Each group present replaces that group of template fields; absent groups inherit. Default {}.'),

    // Dispatch
    status_id: uuid.nullable().default(null).describe('Status for created tickets; must belong to the effective board. Null uses the board default.'),
    assigned_to: uuid.nullable().default(null).describe('User created tickets are assigned to. Null leaves them unassigned.'),
    assigned_team_id: uuid.nullable().default(null).describe('Team created tickets are assigned to. Null for none.'),
    additional_agent_ids: z.array(uuid).default([]).describe('Additional agent user UUIDs on created tickets. Default [].'),

    recurrence: recurrenceRuleSchema,
    start_date: dateStringSchema.describe('First date the schedule can fall on, YYYY-MM-DD. For a yearly rule this is the first year it is due.'),
    create_time: timeString.default('08:00').describe('Wall-clock time (HH:MM, tenant time zone) the ticket is created on its create date. Default 08:00.'),
    due_time: timeString.default('17:00').describe('Wall-clock time (HH:MM, tenant time zone) on the due date the ticket is due. Default 17:00.'),
    lead_days: z.number().int().min(0).max(365).default(0).describe('How many days before the due date the ticket is created. 30 creates it a month ahead. Default 0.'),
    non_business_day_policy: nonBusinessDayPolicySchema.default('keep').describe("When the due date is not a business day: 'keep' it, move to the 'previous' business day, or the 'next' one. Default keep."),

    open_previous_policy: z.enum(OPEN_PREVIOUS_POLICIES).default('always_create').describe("'always_create' makes a new ticket even if the previous one is still open; 'skip' skips the occurrence while one is open. Default always_create."),
    notify_client_on_create: z.boolean().default(false).describe('Send the usual new-ticket notification to the client contact when a ticket is created. Default false.'),
  })
  .strict();

export type RecurringTicketDefinitionInput = z.input<typeof recurringTicketDefinitionInputSchema>;
export type ParsedRecurringTicketDefinitionInput = z.output<typeof recurringTicketDefinitionInputSchema>;

/** Draft schedule used for the unsaved "next 5 due dates" preview. */
export const recurringSchedulePreviewInputSchema = z
  .object({
    /** When given, the preview also renders this template's title for the first occurrence. */
    ticket_template_id: uuid.nullable().optional().describe('Optional ticket template UUID; when given the response includes its title rendered for the first occurrence.'),
    /** Client name to render `{{client}}` with in the sample title. */
    sample_client_name: z.string().max(200).nullable().optional().describe('Client name used to render {{client}} in the sample title.'),
    recurrence: recurrenceRuleSchema,
    start_date: dateStringSchema.describe('First date the schedule can fall on, YYYY-MM-DD.'),
    create_time: timeString.describe('Wall-clock create time, HH:MM, tenant time zone.'),
    due_time: timeString.describe('Wall-clock due time, HH:MM, tenant time zone.'),
    lead_days: z.number().int().min(0).max(365).describe('Days before the due date the ticket is created.'),
    non_business_day_policy: nonBusinessDayPolicySchema.describe("'keep', 'previous' or 'next' business day when the due date is not a business day."),
  })
  .strict();

export type RecurringSchedulePreviewInput = z.infer<typeof recurringSchedulePreviewInputSchema>;

export const recurringTicketClientUpdateSchema = z
  .object({
    overrides: recurringTicketOverridesSchema.describe('Overrides for this client only, layered on top of the definition overrides. Send {} to clear.'),
    contact_id: uuid.nullable().describe('Requester contact for this client\'s tickets; must belong to the client. Null to clear.'),
    location_id: uuid.nullable().describe('Client location for its tickets; must belong to the client. Null to clear.'),
    asset_ids: z.array(uuid).max(500).describe('Assets linked to each created ticket; each must belong to the client. [] to clear.'),
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
