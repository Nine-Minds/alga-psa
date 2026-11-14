import { z } from 'zod';

/**
 * Input schemas for the site audit server actions. They mirror the v1 request
 * schemas (server/src/lib/api/schemas/assetAudit.ts) so a run started from a
 * laptop and one started from the phone carry the same shape.
 */

export const assetAuditStatusSchema = z.enum(['in_progress', 'completed', 'cancelled']);
export const assetAuditMethodSchema = z.enum(['scan', 'manual', 'register']);

export const auditIdSchema = z.string().guid();

export const startAssetAuditSchema = z.object({
  client_id: z.string().guid(),
  /** null audits the client's assets that have no location. */
  location_id: z.string().guid().nullable().optional(),
  /** Status slugs in scope; empty means every status. */
  statuses: z.array(z.string().min(1)).max(100).optional(),
  notes: z.string().max(2000).optional(),
});

/**
 * The scope the start dialog previews. `client_id` is optional so the same
 * action doubles as the up-front asset:update probe behind every "Start audit"
 * affordance: with no client there is nothing to count, only a verdict.
 */
export const assetAuditScopeSchema = z.object({
  client_id: z.string().guid().optional(),
  location_id: z.string().guid().nullable().optional(),
  statuses: z.array(z.string().min(1)).max(100).optional(),
});

export const assetAuditListFiltersSchema = z.object({
  page: z.number().int().min(1).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  client_id: z.string().guid().optional(),
  location_id: z.string().guid().optional(),
  no_location: z.boolean().optional(),
  status: assetAuditStatusSchema.optional(),
  /**
   * ISO instants; the UI computes day boundaries in the viewer's time zone.
   * Validated as strictly as the v1 query schema, so a malformed value is
   * refused here instead of reaching the SQL comparison.
   */
  started_from: z.string().datetime({ offset: true }).optional(),
  started_to: z.string().datetime({ offset: true }).optional(),
});

export const markAssetAuditItemSchema = z.object({
  asset_id: z.string().guid(),
  /** The web has no camera, so a mark from a laptop is always manual. */
  method: assetAuditMethodSchema.optional(),
});

export type StartAssetAuditInput = z.infer<typeof startAssetAuditSchema>;
export type AssetAuditScopeInput = z.infer<typeof assetAuditScopeSchema>;
export type AssetAuditListFiltersInput = z.infer<typeof assetAuditListFiltersSchema>;
export type MarkAssetAuditItemInput = z.infer<typeof markAssetAuditItemSchema>;
