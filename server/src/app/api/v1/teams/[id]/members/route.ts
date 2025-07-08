/**
 * Team Members API Route
 * GET /api/v1/teams/{id}/members - Get team members
 * POST /api/v1/teams/{id}/members - Add team member
 */

import { ApiTeamController } from '@/lib/api/controllers/ApiTeamController';

const controller = new ApiTeamController();

export const GET = controller.getMembers();
export const POST = controller.addMember();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
