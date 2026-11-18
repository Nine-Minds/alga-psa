/**
 * Schedule Search API Route
 * GET /api/v1/schedules/search - Search schedule entries (start_date, end_date, user_id; paginated)
 */

import { ApiTimeSheetController } from 'server/src/lib/api/controllers/ApiTimeSheetController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new ApiTimeSheetController();

export async function GET(request: Request) {
  try {
    return await controller.searchScheduleEntries()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';