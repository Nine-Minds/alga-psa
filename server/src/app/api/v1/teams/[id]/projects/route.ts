/**
 * Team Projects API Route
 * GET /api/v1/teams/[id]/projects - Get team projects
 * POST /api/v1/teams/[id]/projects - Assign team to project
 */

import { TeamController } from 'server/src/lib/api/controllers/TeamController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new TeamController();

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const req = request as any;
    req.params = params;
    return await controller.getProjects()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const req = request as any;
    req.params = params;
    return await controller.assignToProject()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';