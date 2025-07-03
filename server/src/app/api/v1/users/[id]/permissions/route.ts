/**
 * User Permissions API Route
 * GET /api/v1/users/[id]/permissions - Get user effective permissions
 */

import { UserController } from 'server/src/lib/api/controllers/UserController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const controller = new UserController();
    const req = request as any;
    req.params = params;
    return await controller.getUserPermissions()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';