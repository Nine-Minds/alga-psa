/**
 * Team Member API Route
 * DELETE /api/v1/teams/{id}/members/{userId} - Remove team member
 */

import { ApiTeamControllerV2 } from '@/lib/api/controllers/ApiTeamControllerV2';

const controller = new ApiTeamControllerV2();
export const DELETE = controller.removeMember();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
