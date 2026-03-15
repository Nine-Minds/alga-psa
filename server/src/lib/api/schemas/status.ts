/**
 * Status API Schemas
 * Validation schemas for status-related API endpoints
 */

import { z } from 'zod';
import { paginationQuerySchema, uuidSchema } from './common';

// Status response schema
export const statusResponseSchema = z.object({
  status_id: uuidSchema,
  name: z.string(),
  status_type: z.enum(['ticket', 'project', 'project_task', 'interaction']),
  order_number: z.number(),
  is_closed: z.boolean(),
  is_default: z.boolean().nullable(),
  item_type: z.string().nullable(),
  standard_status_id: z.string().nullable(),
  is_custom: z.boolean().nullable(),
  tenant: uuidSchema
});

// Status list query schema
export const statusListQuerySchema = paginationQuerySchema.extend({
  type: z.enum(['ticket', 'project', 'project_task', 'interaction']).optional(),
  search: z.string().optional(),
  board_id: uuidSchema.optional(),
}).superRefine((value, ctx) => {
  if (value.type === 'ticket' && value.board_id === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['board_id'],
      message: 'board_id is required when querying ticket statuses',
    });
  }
});

// Export types
export type StatusResponse = z.infer<typeof statusResponseSchema>;
export type StatusListQuery = z.infer<typeof statusListQuerySchema>;
