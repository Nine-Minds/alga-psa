/**
 * Time Entry Export API Route
 * GET /api/v1/time-entries/export - Export time entries
 */

import { ApiTimeEntryControllerV2 } from '@/lib/api/controllers/ApiTimeEntryControllerV2';

const controller = new ApiTimeEntryControllerV2();

export const GET = controller.export();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';