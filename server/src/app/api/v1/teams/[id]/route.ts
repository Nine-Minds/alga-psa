/**
 * Team by ID API Route
 * GET /api/v1/teams/[id] - Get team by ID
 * PUT /api/v1/teams/[id] - Update team
 * DELETE /api/v1/teams/[id] - Delete team
 */

import { ApiTeamController } from '@/lib/api/controllers/ApiTeamController';

const controller = new ApiTeamController();

export const GET = controller.getById();
export const PUT = controller.update();
export const DELETE = controller.delete();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';