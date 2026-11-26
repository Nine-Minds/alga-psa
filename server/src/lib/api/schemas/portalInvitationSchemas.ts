/**
 * Client portal invitation API schemas
 *
 * The bulk endpoints answer per contact rather than all-or-nothing: a batch
 * that could not invite everybody is still a 200 whose envelope says exactly
 * who was invited, who was skipped and why, and who failed.
 */

import { z } from 'zod';
import { uuidSchema } from './common';

/** Matches the server action's own cap, so the API refuses before the batch starts. */
export const MAX_BULK_PORTAL_INVITATIONS = 500;

export const portalInvitationStatusSchema = z.enum(['sent', 'skipped', 'failed']);

/**
 * The invitation states a batch can be aimed at, same rule as the MSP UI's
 * filter: the state of the contact's latest invitation. Combined with
 * contact_ids it narrows that list rather than being ignored.
 */
export const portalInvitationStateSchema = z.enum(['expired', 'pending']);

/** POST /api/v1/clients/{id}/portal-invitations */
export const clientPortalInvitationRequestSchema = z
  .object({
    contact_ids: z.array(uuidSchema).min(1).max(MAX_BULK_PORTAL_INVITATIONS).optional(),
    all_eligible: z.boolean().optional(),
    invitation_states: z.array(portalInvitationStateSchema).min(1).optional()
  })
  .refine(
    (body) => (body.contact_ids?.length ?? 0) > 0
      || body.all_eligible === true
      || (body.invitation_states?.length ?? 0) > 0,
    {
      message:
        'Provide contact_ids, set all_eligible to true to invite every eligible contact, '
        + 'or invitation_states to resend to the contacts in those states'
    }
  );

/** POST /api/v1/portal-invitations/bulk */
export const bulkPortalInvitationRequestSchema = z.object({
  contact_ids: z.array(uuidSchema).min(1).max(MAX_BULK_PORTAL_INVITATIONS),
  invitation_states: z.array(portalInvitationStateSchema).min(1).optional()
});

export const portalInvitationResultSchema = z.object({
  contact_id: z.string(),
  email: z.string().optional(),
  status: portalInvitationStatusSchema,
  invitation_id: z.string().optional(),
  error_code: z.string().optional(),
  message: z.string().optional()
});

export const bulkPortalInvitationResponseSchema = z.object({
  total: z.number().int(),
  sent: z.number().int(),
  skipped: z.number().int(),
  failed: z.number().int(),
  results: z.array(portalInvitationResultSchema)
});

export type ClientPortalInvitationRequest = z.infer<typeof clientPortalInvitationRequestSchema>;
export type BulkPortalInvitationRequest = z.infer<typeof bulkPortalInvitationRequestSchema>;
export type BulkPortalInvitationResponse = z.infer<typeof bulkPortalInvitationResponseSchema>;
