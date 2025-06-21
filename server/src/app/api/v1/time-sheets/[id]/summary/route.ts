/**
 * Time Sheet Summary API Route
 * GET /api/v1/time-sheets/[id]/summary - Get time sheet summary
 */

import { TimeSheetController } from 'server/src/lib/api/controllers/TimeSheetController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new TimeSheetController();

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const req = request as any;
    req.params = params;
    return await controller.getSummary()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';