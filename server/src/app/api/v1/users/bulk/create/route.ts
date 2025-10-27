/**
 * Users Bulk Create API Route
 * POST /api/v1/users/bulk/create - Bulk create users
 */

import { ApiUserController } from '@/lib/api/controllers/ApiUserController';
import { handleApiError } from '@product/api/middleware/apiMiddleware';

export async function POST(request: Request) {
  try {
    const controller = new ApiUserController();
    return await controller.create()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';