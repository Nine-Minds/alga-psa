/**
 * Time Entries API Routes
 * GET /api/v1/time-entries - List time entries
 * POST /api/v1/time-entries - Create new time entry
 */

import { ApiTimeEntryControllerV2 } from '@/lib/api/controllers/ApiTimeEntryControllerV2';

const controller = new ApiTimeEntryControllerV2();

export const GET = controller.list();
export const POST = controller.create();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';