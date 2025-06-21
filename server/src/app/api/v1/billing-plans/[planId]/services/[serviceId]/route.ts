/**
 * Billing Plan Service Configuration API Route
 * GET /api/v1/billing-plans/[planId]/services/[serviceId] - Get service configuration
 * PUT /api/v1/billing-plans/[planId]/services/[serviceId] - Update service configuration
 * DELETE /api/v1/billing-plans/[planId]/services/[serviceId] - Remove service from plan
 */

import { BillingPlanController } from 'server/src/lib/api/controllers/BillingPlanController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new BillingPlanController();

export async function GET(request: Request, { params }: { params: { planId: string; serviceId: string } }) {
  try {
    const req = request as any;
    req.params = params;
    return await controller.getServiceConfiguration()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: Request, { params }: { params: { planId: string; serviceId: string } }) {
  try {
    const req = request as any;
    req.params = params;
    return await controller.updateServiceConfiguration()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request, { params }: { params: { planId: string; serviceId: string } }) {
  try {
    const req = request as any;
    req.params = params;
    return await controller.removeService()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';