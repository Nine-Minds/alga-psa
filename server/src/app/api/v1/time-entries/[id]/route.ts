/**
 * Time Entry Detail API Routes
 * GET /api/v1/time-entries/{id} - Get time entry details
 * PUT /api/v1/time-entries/{id} - Update time entry
 * DELETE /api/v1/time-entries/{id} - Delete time entry
 */

import { TimeEntryController } from 'server/src/lib/api/controllers/TimeEntryController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new TimeEntryController();

export async function GET(request: Request) {
  try {
    return await controller.getById()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: Request) {
  try {
    return await controller.update()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    return await controller.delete()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';