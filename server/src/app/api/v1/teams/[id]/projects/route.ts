/**
 * Team Projects API Route
 * GET /api/v1/teams/{id}/projects - Get team projects
 */

import { ApiTeamController } from '@/lib/api/controllers/ApiTeamController';

const controller = new ApiTeamController();

export const GET = controller.getProjects();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
