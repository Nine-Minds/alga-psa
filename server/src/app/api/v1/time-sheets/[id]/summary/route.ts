/**
 * Time Sheet Summary API Route
 * GET /api/v1/time-sheets/[id]/summary - Get time sheet summary
 */

import { TimeSheetController } from 'server/src/lib/api/controllers/TimeSheetController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const timeSheetController = new TimeSheetController();
    const req = request as any;
    req.params = params;
    return await timeSheetController.list()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';