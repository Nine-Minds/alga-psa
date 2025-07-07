/**
 * Feature Access API Route
 * POST /api/v1/feature-access - Check feature access
 */

import { ApiPermissionControllerV2 } from '@/lib/api/controllers/ApiPermissionControllerV2';
import { handleApiError } from '@/lib/api/middleware/apiMiddleware';

const controller = new ApiPermissionControllerV2();

export async function POST(request: Request) {
  try {
    return await controller.checkFeatureAccess()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';