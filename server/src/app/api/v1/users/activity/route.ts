/**
 * Users Activity API Route
 * GET /api/v1/users/activity - Get system-wide user activity
 */

import { UserController } from 'server/src/lib/api/controllers/UserController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new UserController();

export async function GET(request: Request) {
  try {
    return await controller.getActivity()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';