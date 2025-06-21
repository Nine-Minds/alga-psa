/**
 * Schedule Entry Conflicts API Route
 * GET /api/v1/schedules/[id]/conflicts - Get schedule entry conflicts
 */

import { TimeSheetController } from 'server/src/lib/api/controllers/TimeSheetController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new TimeSheetController();

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const req = request as any;
    req.params = params;
    return await controller.getScheduleConflicts()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';