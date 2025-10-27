/**
 * Time Sheets Bulk Operations API Route
 * POST /api/v1/time-sheets/bulk - Bulk operations on time sheets
 */

import { ApiTimeSheetController } from '@product/api/controllers/ApiTimeSheetController';
import { handleApiError } from '@product/api/middleware/apiMiddleware';

export async function POST(request: Request) {
  try {
    const controller = new ApiTimeSheetController();
    return await controller.list()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';