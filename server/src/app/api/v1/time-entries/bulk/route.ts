/**
 * Time Entries Bulk Operations API Routes
 * POST /api/v1/time-entries/bulk - Bulk create time entries
 * PUT /api/v1/time-entries/bulk - Bulk update time entries
 * DELETE /api/v1/time-entries/bulk - Bulk delete time entries
 */

import { TimeEntryController } from 'server/src/lib/api/controllers/TimeEntryController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

export async function POST(request: Request) {
  try {
    const controller = new TimeEntryController();
    return await controller.create()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const controller = new TimeEntryController();
    return await controller.bulkUpdate()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const controller = new TimeEntryController();
    return await controller.bulkDelete()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';