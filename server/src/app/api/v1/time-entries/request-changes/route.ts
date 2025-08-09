/**
 * Time Entry Request Changes API Route
 * POST /api/v1/time-entries/request-changes - Request changes to time entries
 */

import { ApiTimeEntryController } from '@/lib/api/controllers/ApiTimeEntryController';

const controller = new ApiTimeEntryController();

export const POST = controller.requestChanges();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';