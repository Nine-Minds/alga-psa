/**
 * Billing Plan Fixed Configuration API Route
 * GET /api/v1/billing-plans/[id]/fixed-config - Get fixed plan configuration
 * PUT /api/v1/billing-plans/[id]/fixed-config - Update fixed plan configuration
 */

import { BillingPlanController } from 'server/src/lib/api/controllers/BillingPlanController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new BillingPlanController();

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const req = request as any;
    req.params = params;
    return await controller.getFixedConfiguration()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  try {
    const req = request as any;
    req.params = params;
    return await controller.upsertFixedConfiguration()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';