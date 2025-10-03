/**
 * Category API Schemas
 * Validation schemas for category operations (service categories and ticket categories)
 */

import { z } from 'zod';
import { 
  uuidSchema, 
  createListQuerySchema, 
  createUpdateSchema,
  baseFilterSchema,
  booleanTransform,
  numberTransform,
  dateSchema
} from './common';

// ============================================================================
// ENUMS AND CONSTANTS
// ============================================================================

export const categoryTypes = [
  'service', 
  'ticket'
] as const;

export const categoryTypeSchema = z.enum(categoryTypes);

// ============================================================================
// SERVICE CATEGORY SCHEMAS
// ============================================================================

// Service Category Schemas
export const createServiceCategorySchema = z.object({
  category_name: z.string()
    .min(1, 'Category name is required')
    .max(255, 'Category name too long')
    .trim(),
  description: z.string()
    .max(1000, 'Description too long')
    .optional(),
  is_active: booleanTransform.or(z.boolean()).optional()
});

export const updateServiceCategorySchema = createUpdateSchema(createServiceCategorySchema);

export const serviceCategoryResponseSchema = z.object({
  category_id: uuidSchema,
  category_name: z.string(),
  description: z.string().nullable(),
  is_active: z.boolean(),
  tenant: uuidSchema,
  created_by: uuidSchema,
  updated_by: uuidSchema,
  created_at: dateSchema,
  updated_at: dateSchema
});

// ============================================================================
// TICKET CATEGORY SCHEMAS
// ============================================================================

// Ticket Category Schemas
export const createTicketCategorySchema = z.object({
  category_name: z.string()
    .min(1, 'Category name is required')
    .max(255, 'Category name too long')
    .trim(),
  board_id: uuidSchema,
  parent_category: uuidSchema.optional(),
  description: z.string()
    .max(1000, 'Description too long')
    .optional()
});

export const updateTicketCategorySchema = createUpdateSchema(createTicketCategorySchema);

export const ticketCategoryResponseSchema: z.ZodType<any> = z.object({
  category_id: uuidSchema,
  category_name: z.string(),
  parent_category: uuidSchema.nullable(),
  board_id: uuidSchema,
  description: z.string().nullable(),
  created_by: uuidSchema,
  updated_by: uuidSchema,
  created_at: dateSchema,
  updated_at: dateSchema,
  tenant: uuidSchema,
  // Hierarchical data
  children: z.array(z.lazy(() => ticketCategoryResponseSchema)).optional(),
  depth: z.number().optional(),
  path: z.string().optional(),
  children_count: z.number().optional()
});

// ============================================================================
// CATEGORY FILTER SCHEMAS
// ============================================================================

// Service Category Filters
export const serviceCategoryFilterSchema = baseFilterSchema.extend({
  category_name: z.string().optional(),
  has_description: booleanTransform.optional(),
  active: booleanTransform.optional(),
  limit: numberTransform.optional(),
  offset: numberTransform.optional(),
  sort_by: z.string().optional(),
  sort_order: z.enum(['asc', 'desc']).optional(),
  include_hierarchy: booleanTransform.optional()
});

export const serviceCategoryListQuerySchema = createListQuerySchema(serviceCategoryFilterSchema);

// Ticket Category Filters
export const ticketCategoryFilterSchema = baseFilterSchema.extend({
  category_name: z.string().optional(),
  board_id: uuidSchema.optional(),
  parent_category: uuidSchema.optional(),
  is_parent: booleanTransform.optional(), // Categories without parents
  is_child: booleanTransform.optional(),  // Categories with parents
  depth: numberTransform.optional(),
  active: booleanTransform.optional(),
  limit: numberTransform.optional(),
  offset: numberTransform.optional(),
  sort_by: z.string().optional(),
  sort_order: z.enum(['asc', 'desc']).optional(),
  include_hierarchy: booleanTransform.optional(),
  category_type: categoryTypeSchema.optional()
});

export const ticketCategoryListQuerySchema = createListQuerySchema(ticketCategoryFilterSchema);

// ============================================================================
// CATEGORY TREE MANAGEMENT SCHEMAS
// ============================================================================

export const moveCategorySchema = z.object({
  category_id: uuidSchema,
  new_parent_id: uuidSchema.optional(), // null/undefined for root level
  position: z.number().int().min(0).optional() // Position within siblings
});

export const reorderCategoriesSchema = z.object({
  category_orders: z.array(z.object({
    category_id: uuidSchema,
    order: z.number().int().min(0)
  })).min(1, 'At least one category order is required')
});

export const categoryTreeResponseSchema: z.ZodType<any> = z.object({
  category_id: uuidSchema,
  category_name: z.string(),
  parent_category: uuidSchema.nullable(),
  children: z.array(z.lazy(() => categoryTreeResponseSchema)),
  depth: z.number(),
  path: z.string(),
  order: z.number().optional(),
  usage_count: z.number().optional()
});

// ============================================================================
// ANALYTICS AND STATISTICS SCHEMAS
// ============================================================================

// Category Usage Analytics
export const categoryAnalyticsFilterSchema = z.object({
  category_type: categoryTypeSchema.optional(),
  board_id: uuidSchema.optional(),
  date_from: dateSchema,
  date_to: dateSchema,
  include_usage: booleanTransform.optional()
});

export const categoryUsageStatsSchema = z.object({
  category_id: uuidSchema,
  category_name: z.string(),
  usage_count: z.number(),
  last_used: dateSchema.optional()
});

export const categoryAnalyticsResponseSchema = z.object({
  total_categories: z.number(),
  active_categories: z.number(),
  categories_with_children: z.number(),
  average_depth: z.number(),
  max_depth: z.number(),
  usage_stats: z.array(categoryUsageStatsSchema)
});

// ============================================================================
// SEARCH SCHEMAS
// ============================================================================

export const categorySearchSchema = z.object({
  search_term: z.string().min(1, 'Search term is required'),
  category_type: categoryTypeSchema.optional(),
  board_id: uuidSchema.optional(),
  include_inactive: booleanTransform.optional(),
  limit: numberTransform.optional(),
  offset: numberTransform.optional()
});

// ============================================================================
// BULK OPERATIONS SCHEMAS
// ============================================================================

export const bulkDeleteCategoriesSchema = z.object({
  category_ids: z.array(uuidSchema).min(1, 'At least one category ID is required').max(50, 'Too many categories for bulk operation'),
  category_type: categoryTypeSchema,
  force: booleanTransform.optional().default("false") // Force delete even if in use
});

export const bulkUpdateCategoriesSchema = z.object({
  category_ids: z.array(uuidSchema).min(1, 'At least one category ID is required').max(50, 'Too many categories for bulk operation'),
  category_type: categoryTypeSchema,
  data: z.object({
    is_active: booleanTransform.optional(),
    parent_category: uuidSchema.optional()
  })
});

// ============================================================================
// IMPORT/EXPORT SCHEMAS
// ============================================================================

export const importCategoriesSchema = z.object({
  categories: z.array(z.object({
    category_name: z.string().min(1).max(255),
    parent_name: z.string().optional(), // Parent category name for hierarchy
    description: z.string().max(1000).optional(),
    board_id: uuidSchema.optional() // For ticket categories
  })).min(1, 'At least one category is required'),
  category_type: categoryTypeSchema,
  merge_strategy: z.enum(['skip', 'update', 'merge']).optional().default('skip')
});

// ============================================================================
// VALIDATION AND CONSTRAINT SCHEMAS
// ============================================================================

// Category Validation Rules
export const categoryValidationRulesSchema = z.object({
  max_depth: z.number().int().min(1).max(10).optional().default(5),
  allow_empty_categories: booleanTransform.optional().default("true"),
  unique_names_per_level: booleanTransform.optional().default("true"),
  max_children: z.number().int().min(1).max(100).optional().default(50)
});

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type CategoryType = z.infer<typeof categoryTypeSchema>;
export type CreateServiceCategoryData = z.infer<typeof createServiceCategorySchema>;
export type CreateTicketCategoryData = z.infer<typeof createTicketCategorySchema>;
export type ServiceCategoryResponse = z.infer<typeof serviceCategoryResponseSchema>;
export type TicketCategoryResponse = z.infer<typeof ticketCategoryResponseSchema>;
export type CategoryFilterParams = z.infer<typeof ticketCategoryFilterSchema>;
export type ServiceCategoryFilterParams = z.infer<typeof serviceCategoryFilterSchema>;
export type CategoryUsageStats = z.infer<typeof categoryUsageStatsSchema>;
export type CategoryTreeNode = z.infer<typeof categoryTreeResponseSchema>;
export type CategoryAnalyticsResponse = z.infer<typeof categoryAnalyticsResponseSchema>;
