/**
 * Time Sheets Bulk Operations API Route
 * POST /api/v1/time-sheets/bulk - Bulk operations on time sheets
 */

import { TimeSheetController } from 'server/src/lib/api/controllers/TimeSheetController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new TimeSheetController();

export async function POST(request: Request) {
  try {
    return await controller.bulkOperations()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';