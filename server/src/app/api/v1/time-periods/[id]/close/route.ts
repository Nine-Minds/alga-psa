/**
 * Time Period Close API Route
 * POST /api/v1/time-periods/[id]/close - Close time period
 */

import { TimeSheetController } from 'server/src/lib/api/controllers/TimeSheetController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new TimeSheetController();

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const req = request as any;
    req.params = params;
    return await controller.closeTimePeriod()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';