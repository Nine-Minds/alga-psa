/**
 * Time Sheet Entries API Route
 * GET /api/v1/time-sheets/[id]/entries - Get time sheet entries
 */

import { ApiTimeSheetController } from '@product/api/controllers/ApiTimeSheetController';
import { handleApiError } from '@product/api/middleware/apiMiddleware';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const timeSheetController = new ApiTimeSheetController();
    const req = request as any;
    req.params = params;
    return await timeSheetController.list()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';