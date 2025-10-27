/**
 * Time Sheet Add Entry API Route
 * POST /api/v1/time-sheets/[id]/add-entry - Add time entry to time sheet
 */

import { ApiTimeSheetController } from '@product/api/controllers/ApiTimeSheetController';
import { handleApiError } from '@product/api/middleware/apiMiddleware';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const timeSheetController = new ApiTimeSheetController();
    const req = request as any;
    req.params = params;
    return await timeSheetController.create()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';