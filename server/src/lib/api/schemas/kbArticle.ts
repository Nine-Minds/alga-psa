/**
 * KB Article API Schemas
 * Validation schemas for knowledge base article endpoints
 */

import { z } from 'zod';
import { paginationQuerySchema, uuidSchema } from './common';

// Enums
export const articleTypeEnum = z.enum(['how_to', 'faq', 'troubleshooting', 'reference']);
export const articleAudienceEnum = z.enum(['internal', 'client', 'public']);
export const articleStatusEnum = z.enum(['draft', 'review', 'published', 'archived']);

// Create schema
export const createKbArticleSchema = z.object({
  title: z.string().min(1).max(255),
  slug: z.string().max(255).optional(),
  article_type: articleTypeEnum.optional().default('how_to'),
  audience: articleAudienceEnum.optional().default('internal'),
  category_id: uuidSchema.optional().nullable(),
  review_cycle_days: z.number().int().min(1).optional().nullable(),
  content: z.string().optional(),
  content_format: z.enum(['markdown', 'blocknote']).optional().default('markdown'),
}).strict();

// Update schema
export const updateKbArticleSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  slug: z.string().max(255).optional(),
  article_type: articleTypeEnum.optional(),
  audience: articleAudienceEnum.optional(),
  category_id: uuidSchema.optional().nullable(),
  review_cycle_days: z.number().int().min(1).optional().nullable(),
  status: articleStatusEnum.optional(),
}).strict();

// Content update schema
export const updateKbArticleContentSchema = z.object({
  content: z.string().min(1),
  format: z.enum(['markdown', 'blocknote']).optional().default('markdown'),
}).strict();

// List query schema
export const kbArticleListQuerySchema = paginationQuerySchema.extend({
  status: articleStatusEnum.optional(),
  audience: articleAudienceEnum.optional(),
  article_type: articleTypeEnum.optional(),
  category_id: z.string().optional(),
  search: z.string().optional(),
});

// Export types
export type CreateKbArticleData = z.infer<typeof createKbArticleSchema>;
export type UpdateKbArticleData = z.infer<typeof updateKbArticleSchema>;
export type UpdateKbArticleContentData = z.infer<typeof updateKbArticleContentSchema>;
export type KbArticleListQuery = z.infer<typeof kbArticleListQuerySchema>;
