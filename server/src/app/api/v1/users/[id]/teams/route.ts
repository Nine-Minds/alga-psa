/**
 * User Teams API Route
 * GET /api/v1/users/[id]/teams - Get user teams
 * POST /api/v1/users/[id]/teams - Add user to team
 */

import { UserController } from 'server/src/lib/api/controllers/UserController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new UserController();

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const req = request as any;
    req.params = params;
    return await controller.getUserTeams()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const req = request as any;
    req.params = params;
    return await controller.addUserToTeam()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';