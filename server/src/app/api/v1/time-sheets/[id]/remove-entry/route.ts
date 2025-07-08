/**
 * Time Sheet Remove Entry API Route
 * DELETE /api/v1/time-sheets/[id]/remove-entry - Remove time entry from time sheet
 */

import { ApiTimeSheetControllerV2 } from 'server/src/lib/api/controllers/ApiTimeSheetControllerV2';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const timeSheetController = new ApiTimeSheetControllerV2();
    const req = request as any;
    req.params = params;
    return await timeSheetController.delete()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';