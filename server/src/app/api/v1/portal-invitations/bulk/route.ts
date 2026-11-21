/**
 * Bulk Portal Invitations API Route
 * POST /api/v1/portal-invitations/bulk - invite named contacts to the client portal
 *
 * Takes explicit `contact_ids` across any client; each contact is authorized
 * against its own client before an invitation is sent.
 */

import { ApiPortalInvitationController } from '@/lib/api/controllers/ApiPortalInvitationController';

const controller = new ApiPortalInvitationController();

export const POST = controller.inviteContacts();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
