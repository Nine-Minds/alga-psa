/**
 * Tag API Schemas
 * Validation schemas for tag operations and entity tagging
 */

import { z } from 'zod';
import { 
  uuidSchema, 
  createListQuerySchema, 
  createUpdateSchema,
  baseFilterSchema,
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
  'client', 
  'ticket', 
  'project', 
  'project_task', 
  'workflow_form'
] as const;

export const taggedEntityTypeSchema = z.enum(taggedEntityTypes);

// Color validation for hex codes
export const hexColorSchema = z.string()
  .regex(/^#[0-9A-F]{6}$/i, 'Must be a valid hex color code (e.g., #FF0000)')
  .optional();

// ============================================================================
// TAG SCHEMAS
// ============================================================================

// Base Tag Schema
export const createTagSchema = z.object({
  tag_text: z.string()
    .min(1, 'Tag text is required')
    .max(50, 'Tag text too long')
    .trim()
    .regex(/^[a-zA-Z0-9\-_\s!@#$%^&*()+=\[\]{};':",./<>?]+$/, 'Tag contains invalid characters'),
  tagged_id: uuidSchema,
  tagged_type: taggedEntityTypeSchema,
  board_id: uuidSchema.optional(),
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
  board_id: uuidSchema.nullable(),
  background_color: z.string().nullable(),
  text_color: z.string().nullable(),
  tenant: uuidSchema,
  created_by: uuidSchema.optional(),
  created_at: dateSchema.optional(),
  updated_at: dateSchema.optional()
});

// Tag Color Update Schema
export const updateTagColorSchema = z.object({
  background_color: hexColorSchema,
  text_color: hexColorSchema
});

// Tag Text Update Schema
export const updateTagTextSchema = z.object({
  tag_text: z.string()
    .min(1, 'Tag text is required')
    .max(50, 'Tag text too long')
    .trim()
});

// Delete Tags by Text Schema
export const deleteTagsByTextSchema = z.object({
  tag_text: z.string()
    .min(1, 'Tag text is required')
    .max(50, 'Tag text too long')
    .trim(),
  tagged_type: taggedEntityTypeSchema
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
  board_id: uuidSchema.optional(),
  default_colors: z.object({
    background_color: hexColorSchema,
    text_color: hexColorSchema
  }).optional()
});

// ============================================================================
// TAG FILTER SCHEMAS
// ============================================================================

export const tagFilterSchema = baseFilterSchema.extend({
  tag_text: z.string().optional(),
  tagged_id: uuidSchema.optional(),
  tagged_type: taggedEntityTypeSchema.optional(),
  entity_type: taggedEntityTypeSchema.optional(),
  entity_id: uuidSchema.optional(),
  board_id: uuidSchema.optional(),
  has_color: booleanTransform.optional(),
  background_color: hexColorSchema,
  text_color: hexColorSchema,
  // Tag usage filters
  usage_count_min: numberTransform.optional(),
  usage_count_max: numberTransform.optional(),
  // Multiple entity filters
  tagged_ids: z.array(uuidSchema).optional(),
  tagged_types: z.array(taggedEntityTypeSchema).optional(),
  // Additional filter properties
  active: booleanTransform.optional(),
  limit: numberTransform.optional(),
  offset: numberTransform.optional(),
  sort_by: z.string().optional(),
  sort_order: z.enum(['asc', 'desc']).optional(),
  created_after: z.string().optional(),
  created_before: z.string().optional()
});

export const tagListQuerySchema = createListQuerySchema(tagFilterSchema);

// ============================================================================
// ENTITY TAGGING SCHEMAS
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
// ANALYTICS AND STATISTICS SCHEMAS
// ============================================================================

// Tag Usage Analytics
export const tagAnalyticsFilterSchema = z.object({
  entity_type: taggedEntityTypeSchema.optional(),
  board_id: uuidSchema.optional(),
  date_from: dateSchema,
  date_to: dateSchema,
  tag_text: z.string().optional(),
  include_usage: booleanTransform.optional()
});

export const tagUsageStatsSchema = z.object({
  tag_text: z.string(),
  usage_count: z.number(),
  entity_types: z.array(taggedEntityTypeSchema),
  last_used: dateSchema.optional()
});

export const tagAnalyticsResponseSchema = z.object({
  total_tags: z.number(),
  unique_tags: z.number(),
  most_used_tags: z.array(z.object({
    tag_text: z.string(),
    usage_count: z.number(),
    entity_types: z.array(z.string())
  })),
  tags_by_entity_type: z.record(z.number()),
  recent_tags: z.array(z.object({
    tag_text: z.string(),
    created_at: z.string(),
    entity_type: z.string()
  }))
});

export const tagCloudSchema = z.object({
  tag_text: z.string(),
  usage_count: z.number(),
  weight: z.number(),
  background_color: z.string().nullable(),
  text_color: z.string().nullable()
});

export const tagCloudResponseSchema = z.object({
  tags: z.array(tagCloudSchema),
  total_tags: z.number(),
  max_weight: z.number()
});

// ============================================================================
// SEARCH SCHEMAS
// ============================================================================

export const tagSearchSchema = z.object({
  search_term: z.string().min(1, 'Search term is required'),
  entity_type: taggedEntityTypeSchema.optional(),
  entity_id: uuidSchema.optional(),
  board_id: uuidSchema.optional(),
  include_usage: booleanTransform.optional(),
  limit: numberTransform.optional(),
  offset: numberTransform.optional()
});

// ============================================================================
// BULK OPERATIONS SCHEMAS
// ============================================================================

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
  board_id: uuidSchema.optional()
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

// ============================================================================
// RESPONSE SCHEMAS
// ============================================================================

// Tag with Usage Info
export const tagWithUsageSchema = tagResponseSchema.extend({
  usage_count: z.number(),
  entities: z.array(z.object({
    entity_id: uuidSchema,
    entity_type: taggedEntityTypeSchema,
    entity_name: z.string().optional()
  })).optional()
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
export type CreateTagData = z.infer<typeof createTagSchema>;
export type UpdateTagData = z.infer<typeof updateTagSchema>;
export type TagResponse = z.infer<typeof tagResponseSchema>;
export type TagFilterParams = z.infer<typeof tagFilterSchema>;
export type TagUsageStats = z.infer<typeof tagUsageStatsSchema>;
export type TagCloudData = z.infer<typeof tagCloudSchema>;
export type TagAnalyticsResponse = z.infer<typeof tagAnalyticsResponseSchema>;
export type EntityReference = z.infer<typeof entityReferenceSchema>;
export type TagWithUsage = z.infer<typeof tagWithUsageSchema>;