/**
 * Billing Analytics Overview API Route
 * GET /api/v1/billing-analytics/overview - Get billing overview analytics
 */

import { BillingPlanController } from 'server/src/lib/api/controllers/BillingPlanController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new BillingPlanController();

export async function GET(request: Request) {
  try {
    return await controller.getBillingOverview()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';