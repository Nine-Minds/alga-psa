/**
 * Client Portal Invitations API Route
 * POST /api/v1/clients/{id}/portal-invitations - invite the client's contacts to the client portal
 *
 * Body is either `{ "all_eligible": true }` for every contact of the client
 * without a portal user, or `{ "contact_ids": [...] }` for a subset; ids that
 * do not belong to the client in the path are reported as skipped, never sent.
 */

import { ApiPortalInvitationController } from '@/lib/api/controllers/ApiPortalInvitationController';

const controller = new ApiPortalInvitationController();

export const POST = controller.inviteClientContacts();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
