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
  inbound_reply_reopen_enabled: z.boolean().optional(),
  inbound_reply_reopen_cutoff_hours: z.number().int().optional(),
  inbound_reply_reopen_status_id: uuidSchema.nullable().optional(),
  inbound_reply_ai_ack_suppression_enabled: z.boolean().optional(),
  enable_live_ticket_timer: z.boolean().nullable(),
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
