/**
 * Team Bulk Members API Route
 * POST /api/v1/teams/{id}/members/bulk - Bulk add team members
 */

import { ApiTeamController } from '@/lib/api/controllers/ApiTeamController';

const controller = new ApiTeamController();

export const POST = controller.bulkAddMembers();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
