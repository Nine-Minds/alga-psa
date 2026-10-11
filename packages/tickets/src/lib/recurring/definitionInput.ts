import { z } from 'zod';
import {
  dateStringSchema,
  isValidTimeString,
  nonBusinessDayPolicySchema,
  recurrenceRuleSchema,
} from '@alga-psa/shared/lib/recurrence';
import { recurringTicketOverridesSchema } from './effectiveFields';
import { findUnknownTitleTokens, RECURRING_TITLE_TOKENS } from './titleTemplate';

/**
 * Input schemas for the recurring-ticket actions (plan §4.9). Kept out of the `'use server'` module
 * because a server-action file may only export async functions, and the editor reuses them for
 * client-side checks.
 */
const uuid = z.string().uuid();
const timeString = z.string().refine(isValidTimeString, 'Expected a time in HH:MM format');

export const OPEN_PREVIOUS_POLICIES = ['always_create', 'skip'] as const;
export type OpenPreviousPolicy = (typeof OPEN_PREVIOUS_POLICIES)[number];

export const titleTemplateSchema = z
  .string()
  .trim()
  .min(1, 'Title is required')
  .max(500)
  .superRefine((template, ctx) => {
    const unknown = findUnknownTitleTokens(template);
    if (unknown.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Unknown title token${unknown.length > 1 ? 's' : ''} ${unknown
          .map((token) => `{{${token}}}`)
          .join(', ')}. Available tokens: ${RECURRING_TITLE_TOKENS.map((token) => `{{${token}}}`).join(', ')}`,
        params: {
          messageKey: 'features/tickets:recurring.errors.unknownTitleTokens',
          messageParams: {
            tokens: unknown.map((token) => `{{${token}}}`).join(', '),
            available: RECURRING_TITLE_TOKENS.map((token) => `{{${token}}}`).join(', '),
          },
        },
      });
    }
  });

/** BlockNote document, the same JSON the quick-add ticket dialog serializes. */
const blockNoteSchema = z.array(z.record(z.string(), z.unknown()));

export const recurringTicketDefinitionInputSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(200),
    is_active: z.boolean().default(true),

    title_template: titleTemplateSchema,
    description: blockNoteSchema.nullable().default(null),
    board_id: uuid,
    status_id: uuid.nullable().default(null),
    priority_id: uuid,
    category_id: uuid.nullable().default(null),
    subcategory_id: uuid.nullable().default(null),
    assigned_to: uuid.nullable().default(null),
    assigned_team_id: uuid.nullable().default(null),
    additional_agent_ids: z.array(uuid).default([]),
    tags: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
    checklist_template_id: uuid.nullable().default(null),

    recurrence: recurrenceRuleSchema,
    start_date: dateStringSchema,
    create_time: timeString.default('08:00'),
    due_time: timeString.default('17:00'),
    lead_days: z.number().int().min(0).max(365).default(0),
    non_business_day_policy: nonBusinessDayPolicySchema.default('keep'),

    open_previous_policy: z.enum(OPEN_PREVIOUS_POLICIES).default('always_create'),
    notify_client_on_create: z.boolean().default(false),
  })
  .strict()
  .superRefine((input, ctx) => {
    if (input.subcategory_id && !input.category_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['subcategory_id'],
        message: 'A subcategory requires a category',
        params: { messageKey: 'features/tickets:recurring.errors.subcategoryNeedsCategory' },
      });
    }
  });

export type RecurringTicketDefinitionInput = z.input<typeof recurringTicketDefinitionInputSchema>;
export type ParsedRecurringTicketDefinitionInput = z.output<typeof recurringTicketDefinitionInputSchema>;

/** Draft schedule used for the unsaved "next 5 due dates" preview. */
export const recurringSchedulePreviewInputSchema = z
  .object({
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
