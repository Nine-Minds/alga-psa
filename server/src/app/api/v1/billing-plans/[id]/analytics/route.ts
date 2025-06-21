/**
 * Billing Plan Analytics API Route
 * GET /api/v1/billing-plans/[id]/analytics - Get billing plan analytics
 */

import { BillingPlanController } from 'server/src/lib/api/controllers/BillingPlanController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new BillingPlanController();

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const req = request as any;
    req.params = params;
    return await controller.getPlanAnalytics()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';