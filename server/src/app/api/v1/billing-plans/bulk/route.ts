/**
 * Billing Plans Bulk Operations API Route
 * POST /api/v1/billing-plans/bulk - Bulk operations on billing plans
 */

import { BillingPlanController } from 'server/src/lib/api/controllers/BillingPlanController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new BillingPlanController();

export async function POST(request: Request) {
  try {
    return await controller.bulkCreate()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: Request) {
  try {
    return await controller.bulkUpdate()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    return await controller.bulkDelete()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';