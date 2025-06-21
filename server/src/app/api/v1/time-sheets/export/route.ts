/**
 * Time Sheets Export API Route
 * GET /api/v1/time-sheets/export - Export time sheets
 */

import { TimeSheetController } from 'server/src/lib/api/controllers/TimeSheetController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new TimeSheetController();

export async function GET(request: Request) {
  try {
    return await controller.export()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';