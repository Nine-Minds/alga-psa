/**
 * Time Sheet Rejection API Route
 * POST /api/v1/time-sheets/[id]/reject - Reject time sheet
 */

import { TimeSheetController } from 'server/src/lib/api/controllers/TimeSheetController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const timeSheetController = new TimeSheetController();
    const req = request as any;
    req.params = params;
    return await timeSheetController.update()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';