/**
 * Time Entry Stop Tracking API Route
 * POST /api/v1/time-entries/stop-tracking/{sessionId} - Stop time tracking
 */

import { ApiTimeEntryControllerV2 } from '@/lib/api/controllers/ApiTimeEntryControllerV2';

const controller = new ApiTimeEntryControllerV2();

export const POST = controller.stopTracking();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';