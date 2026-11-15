/**
 * Time Entry Cancel Tracking API Route
 * POST /api/v1/time-entries/cancel-tracking/{sessionId} - Abandon the caller's own timer without logging time
 * Requires `time_entry:update` (enforced in the controller).
 */

import { ApiTimeEntryController } from '@/lib/api/controllers/ApiTimeEntryController';

const controller = new ApiTimeEntryController();

export const POST = controller.cancelTracking();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
