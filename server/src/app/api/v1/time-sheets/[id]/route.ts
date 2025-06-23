/**
 * Time Sheet by ID API Route
 * GET /api/v1/time-sheets/[id] - Get time sheet by ID
 * PUT /api/v1/time-sheets/[id] - Update time sheet
 * DELETE /api/v1/time-sheets/[id] - Delete time sheet
 */

import { TimeSheetController } from 'server/src/lib/api/controllers/TimeSheetController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const timeSheetController = new TimeSheetController();
    const req = request as any;
    req.params = params;
    return await timeSheetController.getById()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  try {
    const timeSheetController = new TimeSheetController();
    const req = request as any;
    req.params = params;
    return await timeSheetController.update()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  try {
    const timeSheetController = new TimeSheetController();
    const req = request as any;
    req.params = params;
    return await timeSheetController.delete()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';