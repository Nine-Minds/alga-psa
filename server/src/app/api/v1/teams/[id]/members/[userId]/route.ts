/**
 * Team Member API Route
 * DELETE /api/v1/teams/{id}/members/{userId} - Remove team member
 */

import { ApiTeamController } from '@/lib/api/controllers/ApiTeamController';

const controller = new ApiTeamController();
export const DELETE = controller.removeMember();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
