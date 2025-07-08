/**
 * Time Entry Export API Route
 * GET /api/v1/time-entries/export - Export time entries
 */

import { ApiTimeEntryController } from '@/lib/api/controllers/ApiTimeEntryController';

const controller = new ApiTimeEntryController();

export const GET = controller.export();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';