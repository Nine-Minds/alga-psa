/**
 * Time Entry Search API Route
 * GET /api/v1/time-entries/search - Search time entries
 */

import { ApiTimeEntryController } from '@/lib/api/controllers/ApiTimeEntryController';

const controller = new ApiTimeEntryController();

export const GET = controller.search();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';