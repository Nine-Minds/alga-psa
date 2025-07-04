/**
 * Time Entry Request Changes API Route
 * POST /api/v1/time-entries/request-changes - Request changes to time entries
 */

import { ApiTimeEntryControllerV2 } from '@/lib/api/controllers/ApiTimeEntryControllerV2';

const controller = new ApiTimeEntryControllerV2();

export const POST = controller.requestChanges();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';