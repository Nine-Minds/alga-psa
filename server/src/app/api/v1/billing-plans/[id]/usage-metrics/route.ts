/**
 * Billing Plan Usage Metrics API Route
 * GET /api/v1/billing-plans/[id]/usage-metrics - Get plan usage metrics
 */

import { ApiBillingPlanControllerV2 } from 'server/src/lib/api/controllers/ApiBillingPlanControllerV2';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new ApiBillingPlanControllerV2();

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const req = request as any;
    req.params = params;
    return await controller.getUsageMetrics()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';