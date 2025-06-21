/**
 * Team Permissions API Route
 * GET /api/v1/teams/[id]/permissions - Get team permissions
 * POST /api/v1/teams/[id]/permissions - Grant team permission
 */

import { TeamController } from 'server/src/lib/api/controllers/TeamController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new TeamController();

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const req = request as any;
    req.params = params;
    return await controller.getPermissions()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const req = request as any;
    req.params = params;
    return await controller.grantPermission()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';