/**
 * Plan Bundle Plans API Route
 * POST /api/v1/plan-bundles/[bundleId]/plans - Add plan to bundle
 */

import { ApiBillingPlanControllerV2 } from 'server/src/lib/api/controllers/ApiBillingPlanControllerV2';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new ApiBillingPlanControllerV2();

export async function POST(request: Request, { params }: { params: Promise<{ bundleId: string }> }) {
  try {
    const resolvedParams = await params;
    const req = request as any;
    return await controller.addPlanToBundle()(req, resolvedParams);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';