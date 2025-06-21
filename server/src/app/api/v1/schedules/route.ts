/**
 * Schedules API Route
 * GET /api/v1/schedules - List schedule entries
 * POST /api/v1/schedules - Create schedule entry
 */

import { TimeSheetController } from 'server/src/lib/api/controllers/TimeSheetController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new TimeSheetController();

export async function GET(request: Request) {
  try {
    return await controller.listScheduleEntries()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    return await controller.createScheduleEntry()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';