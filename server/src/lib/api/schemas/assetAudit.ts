/**
 * Site audit API schemas (mobile 2.0 FR17).
 */

import { z } from 'zod';
import { booleanTransform, uuidSchema } from './common';

export const assetAuditStatusSchema = z.enum(['in_progress', 'completed', 'cancelled']);
export const assetAuditItemResultSchema = z.enum(['expected', 'present', 'missing', 'unexpected']);
export const assetAuditItemMethodSchema = z.enum(['scan', 'manual', 'register']);

export const createAssetAuditSchema = z.object({
  client_id: uuidSchema,
  /** null audits the client's assets that have no location. */
  location_id: uuidSchema.nullable().optional(),
  /** Status slugs in scope; empty means every status. */
  statuses: z.array(z.string().min(1)).optional(),
  notes: z.string().max(2000).optional()
});

export const markAssetAuditItemSchema = z.object({
  asset_id: uuidSchema,
  /** The caller's intent; an asset outside the snapshot is stored as unexpected. */
  result: z.enum(['present', 'unexpected']).optional().default('present'),
  method: assetAuditItemMethodSchema.optional().default('manual')
});

export const assetAuditListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  client_id: uuidSchema.optional(),
  location_id: uuidSchema.optional(),
  /** Only audits of the client's assets that have no location. Wins over location_id. */
  no_location: booleanTransform.or(z.boolean()).optional(),
  status: assetAuditStatusSchema.optional(),
  /** ISO timestamps; the web UI sends day boundaries in the viewer's time zone. */
  started_from: z.string().datetime({ offset: true }).optional(),
  started_to: z.string().datetime({ offset: true }).optional()
});

export const assetAuditItemResponseSchema = z.object({
  asset_id: uuidSchema,
  result: assetAuditItemResultSchema,
  method: assetAuditItemMethodSchema.nullable(),
  marked_at: z.string().nullable(),
  marked_by: uuidSchema.nullable(),
  asset_name: z.string().nullable().optional(),
  asset_tag: z.string().nullable().optional(),
  serial_number: z.string().nullable().optional(),
  /** Registry slug (built-in or tenant asset_type_registry). */
  asset_type: z.string().nullable().optional(),
  client_id: uuidSchema.nullable().optional(),
  location_id: uuidSchema.nullable().optional(),
  location: z.string().nullable().optional(),
  marked_by_name: z.string().nullable().optional()
});

export const assetAuditResponseSchema = z.object({
  audit_id: uuidSchema,
  tenant: uuidSchema,
  client_id: uuidSchema,
  location_id: uuidSchema.nullable(),
  status: assetAuditStatusSchema,
  started_by: uuidSchema,
  started_at: z.string(),
  completed_at: z.string().nullable(),
  expected_count: z.number().int(),
  present_count: z.number().int(),
  missing_count: z.number().int(),
  unexpected_count: z.number().int(),
  statuses: z.array(z.string()).nullable().optional(),
  notes: z.string().nullable().optional(),
  client_name: z.string().nullable().optional(),
  location_name: z.string().nullable().optional(),
  started_by_name: z.string().nullable().optional(),
  items: z.array(assetAuditItemResponseSchema).optional()
});

export type CreateAssetAuditData = z.infer<typeof createAssetAuditSchema>;
export type MarkAssetAuditItemData = z.infer<typeof markAssetAuditItemSchema>;
export type AssetAuditListQuery = z.infer<typeof assetAuditListQuerySchema>;
