/**
 * Ticket bundling API request schemas.
 */

import { z } from 'zod';

export const bundleModeSchema = z.enum(['link_only', 'sync_updates']);

export const createBundleSchema = z.object({
  child_ticket_ids: z.array(z.string().uuid()).min(1),
  mode: bundleModeSchema.default('sync_updates'),
});

export const addBundleChildrenSchema = z.object({
  child_ticket_ids: z.array(z.string().uuid()).min(1),
});

export const promoteBundleMasterSchema = z.object({
  new_master_ticket_id: z.string().uuid(),
});

export const updateBundleSettingsSchema = z
  .object({
    mode: bundleModeSchema.optional(),
    reopen_on_child_reply: z.boolean().optional(),
  })
  .refine((data) => data.mode !== undefined || data.reopen_on_child_reply !== undefined, {
    message: 'Provide mode and/or reopen_on_child_reply',
  });

export type CreateBundleData = z.infer<typeof createBundleSchema>;
export type AddBundleChildrenData = z.infer<typeof addBundleChildrenSchema>;
export type PromoteBundleMasterData = z.infer<typeof promoteBundleMasterSchema>;
export type UpdateBundleSettingsData = z.infer<typeof updateBundleSettingsSchema>;
