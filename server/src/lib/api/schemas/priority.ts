/**
 * Priority API Schemas
 * Validation schemas for priority-related API endpoints
 */

import { z } from 'zod';
import { paginationQuerySchema, uuidSchema } from './common';

// Priority response schema
export const priorityResponseSchema = z.object({
  priority_id: uuidSchema,
  priority_name: z.string(),
  description: z.string().nullable(),
  order_number: z.number(),
  color: z.string().nullable(),
  item_type: z.enum(['ticket', 'project_task']).nullable(),
  is_from_itil_standard: z.boolean().nullable(),
  tenant: uuidSchema
});

// Priority list query schema
export const priorityListQuerySchema = paginationQuerySchema.extend({
  item_type: z.enum(['ticket', 'project_task']).optional(),
  search: z.string().optional()
});

// Export types
export type PriorityResponse = z.infer<typeof priorityResponseSchema>;
export type PriorityListQuery = z.infer<typeof priorityListQuerySchema>;
