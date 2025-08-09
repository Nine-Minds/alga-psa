/**
 * Schedule Entry Conflicts API Route
 * GET /api/v1/schedules/[id]/conflicts - Get schedule entry conflicts
 */

import { ApiTimeSheetController } from 'server/src/lib/api/controllers/ApiTimeSheetController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new ApiTimeSheetController();

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const req = request as any;
    req.params = params;
    return await controller.list()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';