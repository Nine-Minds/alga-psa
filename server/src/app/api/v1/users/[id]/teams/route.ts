/**
 * User Teams API Route
 * GET /api/v1/users/[id]/teams - Get user teams
 * POST /api/v1/users/[id]/teams - Add user to team
 */

import { ApiUserControllerV2 } from '@/lib/api/controllers/ApiUserControllerV2';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const controller = new ApiUserControllerV2();
    const req = request as any;
    req.params = params;
    return await controller.getUserTeams()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const controller = new ApiUserControllerV2();
    const req = request as any;
    req.params = params;
    return await controller.create()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';