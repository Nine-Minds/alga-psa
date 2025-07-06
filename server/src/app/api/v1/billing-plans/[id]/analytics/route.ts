/**
 * Billing Plan Analytics API Route
 * GET /api/v1/billing-plans/[id]/analytics - Get billing plan analytics
 */

import { ApiBillingPlanControllerV2 } from 'server/src/lib/api/controllers/ApiBillingPlanControllerV2';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new ApiBillingPlanControllerV2();

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const req = request as any;
    req.params = params;
    return await controller.getPlanAnalytics()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';