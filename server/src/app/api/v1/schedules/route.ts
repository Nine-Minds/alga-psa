/**
 * Schedules API Route
 * GET /api/v1/schedules - List schedule entries
 * POST /api/v1/schedules - Create schedule entry
 */

import { ApiTimeSheetController } from '@product/api/controllers/ApiTimeSheetController';
import { handleApiError } from '@product/api/middleware/apiMiddleware';

export async function GET(request: Request) {
  try {
    const controller = new ApiTimeSheetController();
    return await controller.listScheduleEntries()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const controller = new ApiTimeSheetController();
    return await controller.createScheduleEntry()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';