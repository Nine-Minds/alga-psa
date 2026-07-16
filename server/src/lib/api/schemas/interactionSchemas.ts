import { z } from 'zod';
import { paginatedResponseSchema, successResponseSchema, uuidSchema } from './common';

const positiveIntegerQuery = z.string()
  .regex(/^\d+$/, 'Must be a positive integer')
  .transform(Number)
  .refine((value) => value > 0, 'Must be a positive integer');

const optionalDateTime = z.string().datetime().optional();

export const createInteractionApiSchema = z.object({
  type_id: uuidSchema,
  client_id: uuidSchema.optional(),
  contact_name_id: uuidSchema.optional(),
  ticket_id: uuidSchema.optional(),
  project_id: uuidSchema.optional(),
  opportunity_id: uuidSchema.optional(),
  title: z.string().trim().min(1).optional(),
  notes: z.string().optional(),
  duration: z.number().int().nonnegative().optional(),
  start_time: optionalDateTime,
  end_time: optionalDateTime,
  interaction_date: optionalDateTime,
}).superRefine((value, ctx) => {
  if (!value.client_id && !value.contact_name_id) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['client_id'],
      message: 'Either client_id or contact_name_id must be provided',
    });
  }

  if (
    value.start_time &&
    value.end_time &&
    new Date(value.end_time).getTime() < new Date(value.start_time).getTime()
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['end_time'],
      message: 'end_time must be on or after start_time',
    });
  }
});

export const interactionListQuerySchema = z.object({
  client_id: uuidSchema.optional(),
  contact_id: uuidSchema.optional(),
  opportunity_id: uuidSchema.optional(),
  ticket_id: uuidSchema.optional(),
  project_id: uuidSchema.optional(),
  user_id: uuidSchema.optional(),
  type_id: uuidSchema.optional(),
  date_from: optionalDateTime,
  date_to: optionalDateTime,
  page: positiveIntegerQuery.optional().default('1'),
  page_size: positiveIntegerQuery.optional().default('25').transform((value) => Math.min(value, 100)),
}).superRefine((value, ctx) => {
  if (
    value.date_from &&
    value.date_to &&
    new Date(value.date_to).getTime() < new Date(value.date_from).getTime()
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['date_to'],
      message: 'date_to must be on or after date_from',
    });
  }
});

const responseDateTimeSchema = z.union([z.string().datetime(), z.date()]);

export const interactionResponseSchema = z.object({
  tenant: uuidSchema,
  interaction_id: uuidSchema,
  type_id: uuidSchema,
  type_name: z.string().nullable(),
  icon: z.string().nullable(),
  contact_name_id: uuidSchema.nullable(),
  contact_name: z.string().nullable(),
  client_id: uuidSchema.nullable(),
  client_name: z.string().nullable(),
  user_id: uuidSchema,
  user_name: z.string().nullable(),
  ticket_id: uuidSchema.nullable(),
  project_id: uuidSchema.nullable(),
  opportunity_id: uuidSchema.nullable(),
  title: z.string().nullable(),
  notes: z.string().nullable(),
  interaction_date: responseDateTimeSchema,
  start_time: responseDateTimeSchema.nullable(),
  end_time: responseDateTimeSchema.nullable(),
  duration: z.number().int().nullable(),
  status_id: uuidSchema.nullable(),
  status_name: z.string().nullable(),
  is_status_closed: z.boolean().nullable(),
  visibility: z.enum(['internal', 'client_visible']),
});

export const interactionTypeResponseSchema = z.object({
  type_id: uuidSchema,
  type_name: z.string(),
  icon: z.string().nullable(),
  is_system: z.boolean(),
});

export const interactionSuccessResponseSchema = successResponseSchema.extend({
  data: interactionResponseSchema,
});

export const interactionListResponseSchema = paginatedResponseSchema.extend({
  data: z.array(interactionResponseSchema),
});

export const interactionTypeListResponseSchema = successResponseSchema.extend({
  data: z.array(interactionTypeResponseSchema),
});

export type CreateInteractionApi = z.infer<typeof createInteractionApiSchema>;
export type InteractionListQuery = z.infer<typeof interactionListQuerySchema>;
export type InteractionResponse = z.infer<typeof interactionResponseSchema>;
export type InteractionTypeResponse = z.infer<typeof interactionTypeResponseSchema>;
