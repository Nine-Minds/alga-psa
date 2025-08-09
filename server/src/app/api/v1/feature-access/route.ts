/**
 * Feature Access API Route
 * POST /api/v1/feature-access - Check feature access
 */

import { ApiPermissionController } from '@/lib/api/controllers/ApiPermissionController';
import { handleApiError } from '@/lib/api/middleware/apiMiddleware';

const controller = new ApiPermissionController();

export async function POST(request: Request) {
  try {
    return await controller.checkFeatureAccess()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';