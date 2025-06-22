/**
 * Plan Template Create Plan API Route
 * POST /api/v1/plan-templates/[id]/create-plan - Create plan from template
 */

import { BillingPlanController } from 'server/src/lib/api/controllers/BillingPlanController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new BillingPlanController();

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const req = request as any;
    req.params = params;
    return await controller.createFromTemplate()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';