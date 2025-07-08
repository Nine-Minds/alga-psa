/**
 * Time Entry Stop Tracking API Route
 * POST /api/v1/time-entries/stop-tracking/{sessionId} - Stop time tracking
 */

import { ApiTimeEntryController } from '@/lib/api/controllers/ApiTimeEntryController';

const controller = new ApiTimeEntryController();

export const POST = controller.stopTracking();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';