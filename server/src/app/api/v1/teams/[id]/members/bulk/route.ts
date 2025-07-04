/**
 * Team Bulk Members API Route
 * POST /api/v1/teams/{id}/members/bulk - Bulk add team members
 */

import { ApiTeamControllerV2 } from '@/lib/api/controllers/ApiTeamControllerV2';

const controller = new ApiTeamControllerV2();

export const POST = controller.bulkAddMembers();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
