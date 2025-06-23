/**
 * Team Members API Route
 * GET /api/v1/teams/[id]/members - Get team members
 * POST /api/v1/teams/[id]/members - Add member to team
 */

import { TeamController } from 'server/src/lib/api/controllers/TeamController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new TeamController();

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const req = request as any;
    req.params = params;
    return await controller.list()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const req = request as any;
    req.params = params;
    return await controller.create()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';