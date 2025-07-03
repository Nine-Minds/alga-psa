/**
 * Company Billing Plan by ID API Route
 * DELETE /api/v1/company-billing-plans/[id] - Unassign plan from company
 */

import { BillingPlanController } from 'server/src/lib/api/controllers/BillingPlanController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const billingPlanController = new BillingPlanController();
    const req = request as any;
    req.params = params;
    return await billingPlanController.unassignPlanFromCompany()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';