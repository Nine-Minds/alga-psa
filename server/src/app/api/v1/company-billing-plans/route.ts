/**
 * Company Billing Plans API Route
 * POST /api/v1/company-billing-plans - Assign plan to company
 */

import { BillingPlanController } from 'server/src/lib/api/controllers/BillingPlanController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new BillingPlanController();

export async function POST(request: Request) {
  try {
    return await controller.assignPlanToCompany()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';