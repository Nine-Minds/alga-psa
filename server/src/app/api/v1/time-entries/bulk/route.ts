/**
 * Time Entries Bulk Operations API Routes
 * POST /api/v1/time-entries/bulk - Bulk create time entries
 * PUT /api/v1/time-entries/bulk - Bulk update time entries
 * DELETE /api/v1/time-entries/bulk - Bulk delete time entries
 */

import { ApiTimeEntryControllerV2 } from '@/lib/api/controllers/ApiTimeEntryControllerV2';

const controller = new ApiTimeEntryControllerV2();

export const POST = controller.bulkCreate();
export const PUT = controller.bulkUpdate();
export const DELETE = controller.bulkDelete();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';