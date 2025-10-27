/**
 * User Preferences API Route
 * GET /api/v1/users/[id]/preferences - Get user preferences
 * PUT /api/v1/users/[id]/preferences - Update user preferences
 */

import { ApiUserController } from '@/lib/api/controllers/ApiUserController';
import { handleApiError } from '@product/api/middleware/apiMiddleware';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const controller = new ApiUserController();
    const req = request as any;
    req.params = params;
    return await controller.getUserPreferences()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const controller = new ApiUserController();
    const req = request as any;
    req.params = params;
    return await controller.updateUserPreferences()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';