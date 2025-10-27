/**
 * Time Period Close API Route
 * POST /api/v1/time-periods/[id]/close - Close time period
 */

import { ApiTimeSheetController } from '@product/api/controllers/ApiTimeSheetController';
import { handleApiError } from '@product/api/middleware/apiMiddleware';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const controller = new ApiTimeSheetController();
    const req = request as any;
    req.params = params;
    return await controller.update()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';