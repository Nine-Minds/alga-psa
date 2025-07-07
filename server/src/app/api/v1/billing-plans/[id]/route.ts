/**
 * Billing Plan by ID API Route
 * GET /api/v1/billing-plans/[id] - Get billing plan by ID
 * PUT /api/v1/billing-plans/[id] - Update billing plan
 * DELETE /api/v1/billing-plans/[id] - Delete billing plan
 */

import { ApiBillingPlanControllerV2 } from 'server/src/lib/api/controllers/ApiBillingPlanControllerV2';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new ApiBillingPlanControllerV2();

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const req = request as any;
    const resolvedParams = await params;
    return await controller.getById()(req, resolvedParams);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const req = request as any;
    const resolvedParams = await params;
    return await controller.update()(req, resolvedParams);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const req = request as any;
    const resolvedParams = await params;
    return await controller.delete()(req, resolvedParams);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';