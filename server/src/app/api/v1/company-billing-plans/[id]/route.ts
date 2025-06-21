/**
 * Company Billing Plan by ID API Route
 * DELETE /api/v1/company-billing-plans/[id] - Unassign plan from company
 */

import { BillingPlanController } from 'server/src/lib/api/controllers/BillingPlanController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new BillingPlanController();

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  try {
    const req = request as any;
    req.params = params;
    return await controller.unassignPlanFromCompany()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';