/**
 * Billing Plan Fixed Configuration API Route
 * GET /api/v1/billing-plans/[id]/fixed-config - Get fixed plan configuration
 * PUT /api/v1/billing-plans/[id]/fixed-config - Update fixed plan configuration
 */

import { ApiBillingPlanControllerV2 } from 'server/src/lib/api/controllers/ApiBillingPlanControllerV2';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new ApiBillingPlanControllerV2();

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const req = request as any;
    const resolvedParams = await params;
    return await controller.getFixedPlanConfig()(req, resolvedParams);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const req = request as any;
    const resolvedParams = await params;
    return await controller.upsertFixedPlanConfig()(req, resolvedParams);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';