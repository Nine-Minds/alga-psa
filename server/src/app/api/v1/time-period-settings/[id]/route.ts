/**
 * Time Period Settings by ID API Route
 * GET /api/v1/time-period-settings/[id] - Get time period settings by ID
 * PUT /api/v1/time-period-settings/[id] - Update time period settings
 * DELETE /api/v1/time-period-settings/[id] - Delete time period settings
 */

import { ApiTimeSheetController } from 'server/src/lib/api/controllers/ApiTimeSheetController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const controller = new ApiTimeSheetController();
    const req = request as any;
    req.params = params;
    return await controller.getTimePeriodSettingsById()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const controller = new ApiTimeSheetController();
    const req = request as any;
    req.params = params;
    return await controller.updateTimePeriodSettings()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const controller = new ApiTimeSheetController();
    const req = request as any;
    req.params = params;
    return await controller.deleteTimePeriodSettings()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
