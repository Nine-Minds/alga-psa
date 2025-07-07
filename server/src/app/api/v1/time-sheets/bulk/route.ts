/**
 * Time Sheets Bulk Operations API Route
 * POST /api/v1/time-sheets/bulk - Bulk operations on time sheets
 */

import { ApiTimeSheetControllerV2 } from 'server/src/lib/api/controllers/ApiTimeSheetControllerV2';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

export async function POST(request: Request) {
  try {
    const controller = new ApiTimeSheetControllerV2();
    return await controller.list()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';