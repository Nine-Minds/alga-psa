/**
 * Status API Schemas
 * Validation schemas for status-related API endpoints
 */

import { z } from 'zod';
import { paginationQuerySchema, uuidSchema, createUpdateSchema } from './common';

// Create status schema
export const createStatusSchema = z.object({
  name: z.string().min(1, 'Status name is required').max(255),
  status_type: z.enum(['ticket', 'project', 'project_task', 'interaction']),
  board_id: uuidSchema.optional(),
  is_closed: z.boolean().optional(),
  is_default: z.boolean().optional(),
  order_number: z.number().int().min(0).optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Color must be a hex code (e.g. #3B82F6)').optional(),
  icon: z.string().max(50).optional(),
}).superRefine((value, ctx) => {
  if (value.status_type === 'ticket' && !value.board_id) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['board_id'],
      message: 'board_id is required for ticket statuses',
    });
  }
});

// Update status schema (all fields optional)
export const updateStatusSchema = createUpdateSchema(
  z.object({
    name: z.string().min(1, 'Status name is required').max(255),
    is_closed: z.boolean(),
    is_default: z.boolean(),
    order_number: z.number().int().min(0),
    color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Color must be a hex code (e.g. #3B82F6)'),
    icon: z.string().max(50),
  })
);

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
export type CreateStatusData = z.infer<typeof createStatusSchema>;
export type UpdateStatusData = z.infer<typeof updateStatusSchema>;
export type StatusResponse = z.infer<typeof statusResponseSchema>;
export type StatusListQuery = z.infer<typeof statusListQuerySchema>;
