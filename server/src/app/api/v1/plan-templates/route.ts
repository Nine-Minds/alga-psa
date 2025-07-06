/**
 * Plan Templates API Route
 * POST /api/v1/plan-templates - Create plan template
 */

import { ApiBillingPlanControllerV2 } from 'server/src/lib/api/controllers/ApiBillingPlanControllerV2';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new ApiBillingPlanControllerV2();

export async function POST(request: Request) {
  try {
    return await controller.createTemplate()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';