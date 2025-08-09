/**
 * Time Entries API Routes
 * GET /api/v1/time-entries - List time entries
 * POST /api/v1/time-entries - Create new time entry
 */

import { ApiTimeEntryController } from '@/lib/api/controllers/ApiTimeEntryController';

const controller = new ApiTimeEntryController();

export const GET = controller.list();
export const POST = controller.create();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';