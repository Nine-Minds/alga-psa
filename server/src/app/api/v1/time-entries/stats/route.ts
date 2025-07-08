/**
 * Time Entry Statistics API Route
 * GET /api/v1/time-entries/stats - Get time entry statistics
 */

import { ApiTimeEntryController } from '@/lib/api/controllers/ApiTimeEntryController';

const controller = new ApiTimeEntryController();

export const GET = controller.stats();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';