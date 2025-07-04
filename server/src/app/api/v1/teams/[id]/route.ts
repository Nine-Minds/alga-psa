/**
 * Team by ID API Route
 * GET /api/v1/teams/[id] - Get team by ID
 * PUT /api/v1/teams/[id] - Update team
 * DELETE /api/v1/teams/[id] - Delete team
 */

import { ApiTeamControllerV2 } from '@/lib/api/controllers/ApiTeamControllerV2';

const controller = new ApiTeamControllerV2();

export const GET = controller.getById();
export const PUT = controller.update();
export const DELETE = controller.delete();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';