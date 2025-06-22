/**
 * Billing Plan Services API Route
 * GET /api/v1/billing-plans/[id]/services - List plan services
 * POST /api/v1/billing-plans/[id]/services - Add service to plan
 */

import { BillingPlanController } from 'server/src/lib/api/controllers/BillingPlanController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new BillingPlanController();

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const req = request as any;
    req.params = params;
    return await controller.getPlanServices()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const req = request as any;
    req.params = params;
    return await controller.addServiceToPlan()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';