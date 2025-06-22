/**
 * Category & Tag API Schemas
 * Comprehensive validation schemas for category and tag operations
 */

import { z } from 'zod';
import { 
  uuidSchema, 
  createListQuerySchema, 
  createUpdateSchema,
  baseFilterSchema,
  paginationQuerySchema,
  bulkDeleteSchema,
  bulkUpdateSchema,
  booleanTransform,
  numberTransform,
  dateSchema
} from './common';

// ============================================================================
// ENUMS AND CONSTANTS
// ============================================================================

export const taggedEntityTypes = [
  'contact', 
  'company', 
  'ticket', 
  'project', 
  'project_task', 
  'workflow_form'
] as const;

export const taggedEntityTypeSchema = z.enum(taggedEntityTypes);

export const categoryTypes = [
  'service', 
  'ticket'
] as const;

export const categoryTypeSchema = z.enum(categoryTypes);

// Color validation for hex codes
export const hexColorSchema = z.string()
  .regex(/^#[0-9A-F]{6}$/i, 'Must be a valid hex color code (e.g., #FF0000)')
  .optional();

// ============================================================================
// BASE CATEGORY SCHEMAS
// ============================================================================

// Service Category Schemas
export const createServiceCategorySchema = z.object({
  category_name: z.string()
    .min(1, 'Category name is required')
    .max(255, 'Category name too long')
    .trim(),
  description: z.string()
    .max(1000, 'Description too long')
    .optional()
});

export const updateServiceCategorySchema = createUpdateSchema(createServiceCategorySchema);

export const serviceCategoryResponseSchema = z.object({
  category_id: uuidSchema,
  category_name: z.string(),
  description: z.string().nullable(),
  tenant: uuidSchema
});

// Ticket Category Schemas
export const createTicketCategorySchema = z.object({
  category_name: z.string()
    .min(1, 'Category name is required')
    .max(255, 'Category name too long')
    .trim(),
  channel_id: uuidSchema,
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
  channel_id: uuidSchema,
  created_by: uuidSchema,
  created_at: dateSchema,
  tenant: uuidSchema,
  // Hierarchical data
  children: z.array(z.lazy(() => ticketCategoryResponseSchema)).optional(),
  depth: z.number().optional(),
  path: z.string().optional()
});

// ============================================================================
// TAG SCHEMAS
// ============================================================================

// Base Tag Schema
export const createTagSchema = z.object({
  tag_text: z.string()
    .min(1, 'Tag text is required')
    .max(50, 'Tag text too long')
    .trim()
    .transform(val => val.toLowerCase()), // Consistent lowercase tags
  tagged_id: uuidSchema,
  tagged_type: taggedEntityTypeSchema,
  channel_id: uuidSchema.optional(),
  background_color: hexColorSchema,
  text_color: hexColorSchema
});

export const updateTagSchema = createUpdateSchema(createTagSchema.omit({ 
  tagged_id: true, 
  tagged_type: true 
}));

export const tagResponseSchema = z.object({
  tag_id: uuidSchema,
  tag_text: z.string(),
  tagged_id: uuidSchema,
  tagged_type: taggedEntityTypeSchema,
  channel_id: uuidSchema.nullable(),
  background_color: z.string().nullable(),
  text_color: z.string().nullable(),
  tenant: uuidSchema
});

// Tag Color Update Schema
export const updateTagColorSchema = z.object({
  background_color: hexColorSchema,
  text_color: hexColorSchema
});

// Bulk Tag Creation Schema
export const createBulkTagsSchema = z.object({
  tag_texts: z.array(z.string()
    .min(1, 'Tag text is required')
    .max(50, 'Tag text too long')
    .trim()
  ).min(1, 'At least one tag is required')
    .max(20, 'Too many tags at once'),
  tagged_id: uuidSchema,
  tagged_type: taggedEntityTypeSchema,
  channel_id: uuidSchema.optional(),
  default_colors: z.object({
    background_color: hexColorSchema,
    text_color: hexColorSchema
  }).optional()
});

// ============================================================================
// CATEGORY FILTER SCHEMAS
// ============================================================================

// Service Category Filters
export const serviceCategoryFilterSchema = baseFilterSchema.extend({
  category_name: z.string().optional(),
  has_description: booleanTransform.optional()
});

export const serviceCategoryListQuerySchema = createListQuerySchema(serviceCategoryFilterSchema);

// Ticket Category Filters
export const ticketCategoryFilterSchema = baseFilterSchema.extend({
  category_name: z.string().optional(),
  channel_id: uuidSchema.optional(),
  parent_category: uuidSchema.optional(),
  is_parent: booleanTransform.optional(), // Categories without parents
  is_child: booleanTransform.optional(),  // Categories with parents
  depth: numberTransform.optional()
});

export const ticketCategoryListQuerySchema = createListQuerySchema(ticketCategoryFilterSchema);

// ============================================================================
// TAG FILTER SCHEMAS
// ============================================================================

export const tagFilterSchema = baseFilterSchema.extend({
  tag_text: z.string().optional(),
  tagged_id: uuidSchema.optional(),
  tagged_type: taggedEntityTypeSchema.optional(),
  channel_id: uuidSchema.optional(),
  has_color: booleanTransform.optional(),
  background_color: hexColorSchema,
  text_color: hexColorSchema,
  // Tag usage filters
  usage_count_min: numberTransform.optional(),
  usage_count_max: numberTransform.optional(),
  // Multiple entity filters
  tagged_ids: z.array(uuidSchema).optional(),
  tagged_types: z.array(taggedEntityTypeSchema).optional()
});

export const tagListQuerySchema = createListQuerySchema(tagFilterSchema);

// ============================================================================
// RELATIONSHIP AND ENTITY TAGGING SCHEMAS
// ============================================================================

// Entity Tagging Operations
export const tagEntitySchema = z.object({
  entity_id: uuidSchema,
  entity_type: taggedEntityTypeSchema,
  tags: z.array(z.union([
    z.string().min(1).max(50), // New tag text
    z.object({
      tag_id: uuidSchema.optional(),
      tag_text: z.string().min(1).max(50),
      background_color: hexColorSchema,
      text_color: hexColorSchema
    })
  ])).min(1, 'At least one tag is required')
});

export const untagEntitySchema = z.object({
  entity_id: uuidSchema,
  entity_type: taggedEntityTypeSchema,
  tag_ids: z.array(uuidSchema).min(1, 'At least one tag ID is required')
});

// Bulk Entity Tagging
export const bulkTagEntitiesSchema = z.object({
  entities: z.array(z.object({
    entity_id: uuidSchema,
    entity_type: taggedEntityTypeSchema
  })).min(1, 'At least one entity is required')
    .max(100, 'Too many entities for bulk operation'),
  tags: z.array(z.string().min(1).max(50))
    .min(1, 'At least one tag is required')
    .max(20, 'Too many tags for bulk operation')
});

export const bulkUntagEntitiesSchema = z.object({
  entities: z.array(z.object({
    entity_id: uuidSchema,
    entity_type: taggedEntityTypeSchema
  })).min(1, 'At least one entity is required')
    .max(100, 'Too many entities for bulk operation'),
  tag_ids: z.array(uuidSchema).min(1, 'At least one tag ID is required')
});

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

// Tag Usage Analytics
export const tagAnalyticsFilterSchema = z.object({
  entity_type: taggedEntityTypeSchema.optional(),
  channel_id: uuidSchema.optional(),
  date_from: dateSchema,
  date_to: dateSchema,
  limit: z.number().int().min(1).max(100).optional().default(50)
});

export const tagUsageStatsSchema = z.object({
  tag_id: uuidSchema,
  tag_text: z.string(),
  usage_count: z.number(),
  entity_counts: z.record(taggedEntityTypeSchema, z.number()),
  background_color: z.string().nullable(),
  text_color: z.string().nullable(),
  first_used: dateSchema,
  last_used: dateSchema
});

export const tagCloudSchema = z.object({
  tags: z.array(z.object({
    tag_text: z.string(),
    weight: z.number(),
    usage_count: z.number(),
    background_color: z.string().nullable(),
    text_color: z.string().nullable()
  })),
  max_weight: z.number(),
  total_tags: z.number()
});

// Category Usage Analytics
export const categoryAnalyticsFilterSchema = z.object({
  category_type: categoryTypeSchema.optional(),
  channel_id: uuidSchema.optional(),
  date_from: dateSchema,
  date_to: dateSchema,
  include_subcategories: booleanTransform.optional().default("true")
});

export const categoryUsageStatsSchema = z.object({
  category_id: uuidSchema,
  category_name: z.string(),
  usage_count: z.number(),
  subcategory_count: z.number().optional(),
  parent_category: uuidSchema.nullable(),
  depth: z.number().optional(),
  first_used: dateSchema.nullable(),
  last_used: dateSchema.nullable()
});

// ============================================================================
// SEARCH AND FILTERING SCHEMAS
// ============================================================================

// Advanced Tag Search
export const tagSearchSchema = z.object({
  query: z.string().min(1, 'Search query is required'),
  entity_types: z.array(taggedEntityTypeSchema).optional(),
  channel_ids: z.array(uuidSchema).optional(),
  exact_match: booleanTransform.optional().default("false"),
  include_colors: booleanTransform.optional().default("true"),
  limit: z.number().int().min(1).max(100).optional().default(25)
});

export const tagSearchResultSchema = z.object({
  tag_id: uuidSchema,
  tag_text: z.string(),
  usage_count: z.number(),
  background_color: z.string().nullable(),
  text_color: z.string().nullable(),
  relevance_score: z.number().optional()
});

// Advanced Category Search
export const categorySearchSchema = z.object({
  query: z.string().min(1, 'Search query is required'),
  category_type: categoryTypeSchema.optional(),
  channel_id: uuidSchema.optional(),
  include_path: booleanTransform.optional().default("true"),
  include_usage: booleanTransform.optional().default("false"),
  limit: z.number().int().min(1).max(100).optional().default(25)
});

export const categorySearchResultSchema = z.object({
  category_id: uuidSchema,
  category_name: z.string(),
  category_type: categoryTypeSchema,
  path: z.string().optional(),
  usage_count: z.number().optional(),
  parent_category: uuidSchema.nullable(),
  relevance_score: z.number().optional()
});

// ============================================================================
// BULK OPERATIONS SCHEMAS
// ============================================================================

// Bulk Category Operations
export const bulkDeleteCategoriesSchema = bulkDeleteSchema.extend({
  category_type: categoryTypeSchema,
  force: booleanTransform.optional().default("false") // Force delete even if in use
});

export const bulkUpdateCategoriesSchema = bulkUpdateSchema.extend({
  category_type: categoryTypeSchema
});

// Bulk Tag Operations
export const bulkDeleteTagsSchema = bulkDeleteSchema;

export const bulkUpdateTagsSchema = bulkUpdateSchema;

export const bulkMergeTagsSchema = z.object({
  source_tag_ids: z.array(uuidSchema).min(2, 'At least 2 tags required for merge'),
  target_tag_text: z.string().min(1).max(50),
  target_colors: z.object({
    background_color: hexColorSchema,
    text_color: hexColorSchema
  }).optional()
});

// ============================================================================
// IMPORT/EXPORT SCHEMAS
// ============================================================================

export const importTagsSchema = z.object({
  tags: z.array(z.object({
    tag_text: z.string().min(1).max(50),
    entity_type: taggedEntityTypeSchema,
    background_color: hexColorSchema,
    text_color: hexColorSchema
  })).min(1, 'At least one tag is required'),
  merge_strategy: z.enum(['skip', 'update', 'merge']).optional().default('skip'),
  channel_id: uuidSchema.optional()
});

export const importCategoriesSchema = z.object({
  categories: z.array(z.object({
    category_name: z.string().min(1).max(255),
    parent_name: z.string().optional(), // Parent category name for hierarchy
    description: z.string().max(1000).optional(),
    channel_id: uuidSchema.optional() // For ticket categories
  })).min(1, 'At least one category is required'),
  category_type: categoryTypeSchema,
  merge_strategy: z.enum(['skip', 'update', 'merge']).optional().default('skip')
});

// ============================================================================
// VALIDATION AND CONSTRAINT SCHEMAS
// ============================================================================

// Tag Validation Rules
export const tagValidationRulesSchema = z.object({
  max_tags_per_entity: z.number().int().min(1).max(100).optional().default(20),
  allowed_characters: z.string().optional().default('a-zA-Z0-9-_\\s'),
  min_tag_length: z.number().int().min(1).optional().default(1),
  max_tag_length: z.number().int().max(100).optional().default(50),
  case_sensitive: booleanTransform.optional().default("false"),
  auto_suggest: booleanTransform.optional().default("true")
});

// Category Validation Rules
export const categoryValidationRulesSchema = z.object({
  max_depth: z.number().int().min(1).max(10).optional().default(5),
  allow_empty_categories: booleanTransform.optional().default("true"),
  unique_names_per_level: booleanTransform.optional().default("true"),
  max_children: z.number().int().min(1).max(100).optional().default(50)
});

// ============================================================================
// RESPONSE SCHEMAS
// ============================================================================

// Combined Category-Tag Response
export const categoryWithTagsSchema = z.object({
  category: z.union([serviceCategoryResponseSchema, ticketCategoryResponseSchema]),
  tags: z.array(tagResponseSchema),
  usage_stats: z.object({
    total_items: z.number(),
    recent_activity: z.number()
  }).optional()
});

// Tag with Usage Info
export const tagWithUsageSchema = tagResponseSchema.extend({
  usage_count: z.number(),
  entities: z.array(z.object({
    entity_id: uuidSchema,
    entity_type: taggedEntityTypeSchema,
    entity_name: z.string().optional()
  })).optional(),
  created_at: dateSchema.optional(),
  updated_at: dateSchema.optional()
});

// ============================================================================
// UTILITY SCHEMAS AND TYPES
// ============================================================================

// Entity reference for tagging
export const entityReferenceSchema = z.object({
  entity_id: uuidSchema,
  entity_type: taggedEntityTypeSchema,
  entity_name: z.string().optional()
});

// Tag suggestion schema
export const tagSuggestionSchema = z.object({
  suggested_tags: z.array(z.object({
    tag_text: z.string(),
    confidence: z.number().min(0).max(1),
    usage_count: z.number(),
    background_color: z.string().nullable(),
    text_color: z.string().nullable()
  })),
  entity_type: taggedEntityTypeSchema,
  limit: z.number().int().min(1).max(50).optional().default(10)
});

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type TaggedEntityType = z.infer<typeof taggedEntityTypeSchema>;
export type CategoryType = z.infer<typeof categoryTypeSchema>;
export type CreateTagData = z.infer<typeof createTagSchema>;
export type UpdateTagData = z.infer<typeof updateTagSchema>;
export type TagResponse = z.infer<typeof tagResponseSchema>;
export type CreateServiceCategoryData = z.infer<typeof createServiceCategorySchema>;
export type CreateTicketCategoryData = z.infer<typeof createTicketCategorySchema>;
export type ServiceCategoryResponse = z.infer<typeof serviceCategoryResponseSchema>;
export type TicketCategoryResponse = z.infer<typeof ticketCategoryResponseSchema>;
export type TagFilterParams = z.infer<typeof tagFilterSchema>;
export type CategoryFilterParams = z.infer<typeof ticketCategoryFilterSchema>;
export type TagUsageStats = z.infer<typeof tagUsageStatsSchema>;
export type CategoryUsageStats = z.infer<typeof categoryUsageStatsSchema>;
export type TagCloudData = z.infer<typeof tagCloudSchema>;
export type EntityReference = z.infer<typeof entityReferenceSchema>;