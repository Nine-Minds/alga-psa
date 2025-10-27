/**
 * Time Period by ID API Route
 * GET /api/v1/time-periods/[id] - Get time period by ID
 * PUT /api/v1/time-periods/[id] - Update time period
 * DELETE /api/v1/time-periods/[id] - Delete time period
 */

import { ApiTimeSheetController } from '@product/api/controllers/ApiTimeSheetController';
import { handleApiError } from '@product/api/middleware/apiMiddleware';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const controller = new ApiTimeSheetController();
    const req = request as any;
    req.params = params;
    return await controller.getTimePeriod()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const controller = new ApiTimeSheetController();
    const req = request as any;
    req.params = params;
    return await controller.updateTimePeriod()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const controller = new ApiTimeSheetController();
    const req = request as any;
    req.params = params;
    return await controller.deleteTimePeriod()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';