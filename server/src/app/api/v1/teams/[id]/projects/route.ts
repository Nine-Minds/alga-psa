/**
 * Team Projects API Route
 * GET /api/v1/teams/{id}/projects - Get team projects
 */

import { ApiTeamControllerV2 } from '@/lib/api/controllers/ApiTeamControllerV2';

const controller = new ApiTeamControllerV2();

export const GET = controller.getProjects();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
