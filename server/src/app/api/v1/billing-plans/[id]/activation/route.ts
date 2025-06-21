/**
 * Billing Plan Activation API Route
 * PUT /api/v1/billing-plans/[id]/activation - Activate/deactivate billing plan
 */

import { BillingPlanController } from 'server/src/lib/api/controllers/BillingPlanController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new BillingPlanController();

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  try {
    const req = request as any;
    req.params = params;
    return await controller.updateBillingPlan()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';