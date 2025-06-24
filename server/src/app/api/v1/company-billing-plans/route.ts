/**
 * Company Billing Plans API Route
 * POST /api/v1/company-billing-plans - Assign plan to company
 */

import { BillingPlanController } from 'server/src/lib/api/controllers/BillingPlanController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

export async function POST(request: Request) {
  try {
    const billingPlanController = new BillingPlanController();
    return await billingPlanController.assignPlanToCompany()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';