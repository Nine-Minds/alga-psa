/**
 * Plan Bundle Plans API Route
 * POST /api/v1/plan-bundles/[bundleId]/plans - Add plan to bundle
 */

import { BillingPlanController } from 'server/src/lib/api/controllers/BillingPlanController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new BillingPlanController();

export async function POST(request: Request, { params }: { params: Promise<{ bundleId: string }> }) {
  try {
    const resolvedParams = await params;
    const req = request as any;
    req.params = resolvedParams;
    return await controller.addPlanToBundle()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';