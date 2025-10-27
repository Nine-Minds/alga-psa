/**
 * Time Sheets API Route
 * GET /api/v1/time-sheets - List time sheets
 * POST /api/v1/time-sheets - Create time sheet
 */

import { ApiTimeSheetController } from '@product/api/controllers/ApiTimeSheetController';
import { handleApiError } from '@product/api/middleware/apiMiddleware';

export async function GET(request: Request) {
  try {
    const controller = new ApiTimeSheetController();
    return await controller.list()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const controller = new ApiTimeSheetController();
    return await controller.create()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';