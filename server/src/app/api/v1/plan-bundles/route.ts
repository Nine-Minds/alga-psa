/**
 * Plan Bundles API Route
 * POST /api/v1/plan-bundles - Create plan bundle
 */

import { BillingPlanController } from 'server/src/lib/api/controllers/BillingPlanController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new BillingPlanController();

export async function POST(request: Request) {
  try {
    return await controller.createBundle()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';