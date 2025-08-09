/**
 * Time Sheet Request Changes API Route
 * POST /api/v1/time-sheets/[id]/request-changes - Request changes to time sheet
 */

import { ApiTimeSheetController } from 'server/src/lib/api/controllers/ApiTimeSheetController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const timeSheetController = new ApiTimeSheetController();
    const req = request as any;
    req.params = params;
    return await timeSheetController.requestChanges()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';