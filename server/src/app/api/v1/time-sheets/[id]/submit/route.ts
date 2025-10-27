/**
 * Time Sheet Submit API Route
 * POST /api/v1/time-sheets/[id]/submit - Submit time sheet for approval
 */

import { ApiTimeSheetController } from '@product/api/controllers/ApiTimeSheetController';
import { handleApiError } from '@product/api/middleware/apiMiddleware';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const timeSheetController = new ApiTimeSheetController();
    const req = request as any;
    req.params = params;
    return await timeSheetController.submit()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';