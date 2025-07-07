/**
 * Billing Plan Copy API Route
 * POST /api/v1/billing-plans/[id]/copy - Copy billing plan
 */

import { ApiBillingPlanControllerV2 } from 'server/src/lib/api/controllers/ApiBillingPlanControllerV2';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new ApiBillingPlanControllerV2();

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const req = request as any;
    const resolvedParams = await params;
    return await controller.copyPlan()(req, resolvedParams);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';