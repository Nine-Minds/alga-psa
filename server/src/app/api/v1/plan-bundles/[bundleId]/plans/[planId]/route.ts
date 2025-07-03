/**
 * Plan Bundle Plan by ID API Route
 * DELETE /api/v1/plan-bundles/[bundleId]/plans/[planId] - Remove plan from bundle
 */

import { BillingPlanController } from 'server/src/lib/api/controllers/BillingPlanController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new BillingPlanController();

export async function DELETE(request: Request, { params }: { params: Promise<{ bundleId: string; planId: string }> }) {
  try {
    const resolvedParams = await params;
    const req = request as any;
    req.params = resolvedParams;
    return await controller.removePlanFromBundle()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';