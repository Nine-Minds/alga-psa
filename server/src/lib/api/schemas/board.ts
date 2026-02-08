/**
 * Board API Schemas
 * Validation schemas for board-related API endpoints
 */

import { z } from 'zod';
import { paginationQuerySchema, uuidSchema } from './common';

// Board response schema
export const boardResponseSchema = z.object({
  board_id: uuidSchema,
  board_name: z.string(),
  description: z.string().nullable(),
  display_order: z.number(),
  is_default: z.boolean(),
  is_inactive: z.boolean(),
  category_type: z.enum(['custom', 'itil']).nullable(),
  priority_type: z.enum(['custom', 'itil']).nullable(),
  display_itil_impact: z.boolean().nullable(),
  display_itil_urgency: z.boolean().nullable(),
  default_assigned_to: uuidSchema.nullable(),
  tenant: uuidSchema
});

// Board list query schema
export const boardListQuerySchema = paginationQuerySchema.extend({
  include_inactive: z.string().transform(val => val === 'true').optional(),
  search: z.string().optional()
});

// Export types
export type BoardResponse = z.infer<typeof boardResponseSchema>;
export type BoardListQuery = z.infer<typeof boardListQuerySchema>;
