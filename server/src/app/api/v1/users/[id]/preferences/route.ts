/**
 * User Preferences API Route
 * GET /api/v1/users/[id]/preferences - Get user preferences
 * PUT /api/v1/users/[id]/preferences - Update user preferences
 */

import { UserController } from 'server/src/lib/api/controllers/UserController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new UserController();

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const req = request as any;
    req.params = params;
    return await controller.getUserPreferences()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  try {
    const req = request as any;
    req.params = params;
    return await controller.updateUserPreferences()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';