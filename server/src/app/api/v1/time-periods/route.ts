/**
 * Time Periods API Route
 * GET /api/v1/time-periods - List time periods
 * POST /api/v1/time-periods - Create time period
 */

import { ApiTimeSheetController } from '@product/api/controllers/ApiTimeSheetController';
import { handleApiError } from '@product/api/middleware/apiMiddleware';

export async function GET(request: Request) {
  try {
    const controller = new ApiTimeSheetController();
    return await controller.listTimePeriods()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const controller = new ApiTimeSheetController();
    return await controller.createTimePeriod()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';