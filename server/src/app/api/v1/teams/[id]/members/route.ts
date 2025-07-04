/**
 * Team Members API Route
 * GET /api/v1/teams/{id}/members - Get team members
 * POST /api/v1/teams/{id}/members - Add team member
 */

import { ApiTeamControllerV2 } from '@/lib/api/controllers/ApiTeamControllerV2';

const controller = new ApiTeamControllerV2();

export const GET = controller.getMembers();
export const POST = controller.addMember();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
