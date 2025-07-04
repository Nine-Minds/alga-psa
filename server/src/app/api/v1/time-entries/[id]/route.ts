/**
 * Time Entry Detail API Routes
 * GET /api/v1/time-entries/{id} - Get time entry details
 * PUT /api/v1/time-entries/{id} - Update time entry
 * DELETE /api/v1/time-entries/{id} - Delete time entry
 */

import { ApiTimeEntryControllerV2 } from '@/lib/api/controllers/ApiTimeEntryControllerV2';

const controller = new ApiTimeEntryControllerV2();

export const GET = controller.getById();
export const PUT = controller.update();
export const DELETE = controller.delete();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';