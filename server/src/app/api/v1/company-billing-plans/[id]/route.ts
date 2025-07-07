/**
 * Company Billing Plan by ID API Route
 * DELETE /api/v1/company-billing-plans/[id] - Unassign plan from company
 */

import { ApiBillingPlanControllerV2 } from 'server/src/lib/api/controllers/ApiBillingPlanControllerV2';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const billingPlanController = new ApiBillingPlanControllerV2();
    const req = request as any;
    const resolvedParams = await params;
    return await billingPlanController.unassignPlanFromCompany()(req, resolvedParams);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';