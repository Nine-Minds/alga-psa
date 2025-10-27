/**
 * Time Sheet by ID API Route
 * GET /api/v1/time-sheets/[id] - Get time sheet by ID
 * PUT /api/v1/time-sheets/[id] - Update time sheet
 * DELETE /api/v1/time-sheets/[id] - Delete time sheet
 */

import { ApiTimeSheetController } from '@product/api/controllers/ApiTimeSheetController';
import { handleApiError } from '@product/api/middleware/apiMiddleware';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const timeSheetController = new ApiTimeSheetController();
    const req = request as any;
    req.params = params;
    return await timeSheetController.getWithDetails()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const timeSheetController = new ApiTimeSheetController();
    const req = request as any;
    req.params = params;
    return await timeSheetController.update()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const timeSheetController = new ApiTimeSheetController();
    const req = request as any;
    req.params = params;
    return await timeSheetController.delete()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';