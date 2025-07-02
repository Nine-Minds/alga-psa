/**
 * Team Hierarchy Management API Route
 * POST /api/v1/teams/[id]/hierarchy - Create hierarchy relationship
 * DELETE /api/v1/teams/[id]/hierarchy - Remove from hierarchy
 */

import { TeamController } from 'server/src/lib/api/controllers/TeamController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new TeamController();

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const req = request as any;
    req.params = params;
    return await controller.create()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const req = request as any;
    req.params = params;
    return await controller.delete()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';