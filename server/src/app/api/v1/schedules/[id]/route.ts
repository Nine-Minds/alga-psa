/**
 * Schedule Entry by ID API Route
 * GET /api/v1/schedules/[id] - Get schedule entry by ID
 * PUT /api/v1/schedules/[id] - Update schedule entry
 * DELETE /api/v1/schedules/[id] - Delete schedule entry
 */

import { ApiTimeSheetController } from '@product/api/controllers/ApiTimeSheetController';
import { handleApiError } from '@product/api/middleware/apiMiddleware';

const controller = new ApiTimeSheetController();

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const req = request as any;
    req.params = params;
    return await controller.getById()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const req = request as any;
    req.params = params;
    return await controller.updateScheduleEntry()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const req = request as any;
    req.params = params;
    return await controller.deleteScheduleEntry()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';