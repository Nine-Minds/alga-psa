/**
 * Time Entry Start Tracking API Route
 * POST /api/v1/time-entries/start-tracking - Start time tracking session
 */

import { ApiTimeEntryControllerV2 } from '@/lib/api/controllers/ApiTimeEntryControllerV2';

const controller = new ApiTimeEntryControllerV2();

export const POST = controller.startTracking();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';