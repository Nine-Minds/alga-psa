/**
 * Billing Plans API Route
 * GET /api/v1/billing-plans - List billing plans
 * POST /api/v1/billing-plans - Create billing plan
 */

import { BillingPlanController } from 'server/src/lib/api/controllers/BillingPlanController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new BillingPlanController();

export async function GET(request: Request) {
  try {
    return await controller.list()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    return await controller.create()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';