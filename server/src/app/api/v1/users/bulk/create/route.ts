/**
 * Users Bulk Create API Route
 * POST /api/v1/users/bulk/create - Bulk create users
 */

import { UserController } from 'server/src/lib/api/controllers/UserController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new UserController();

export async function POST(request: Request) {
  try {
    return await controller.bulkCreate()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';