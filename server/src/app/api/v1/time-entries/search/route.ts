/**
 * Time Entry Search API Route
 * GET /api/v1/time-entries/search - Search time entries
 */

import { TimeEntryController } from 'server/src/lib/api/controllers/TimeEntryController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new TimeEntryController();

export async function GET(request: Request) {
  try {
    return await controller.list()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';