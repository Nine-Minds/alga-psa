/**
 * Time Entry Request Changes API Route
 * POST /api/v1/time-entries/request-changes - Request changes to time entries
 */

import { TimeEntryController } from 'server/src/lib/api/controllers/TimeEntryController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

export async function POST(request: Request) {
  try {
    const controller = new TimeEntryController();
    return await controller.requestChanges()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';