/**
 * Time Entry Start Tracking API Route
 * POST /api/v1/time-entries/start-tracking - Start time tracking session
 */

import { ApiTimeEntryController } from '@/lib/api/controllers/ApiTimeEntryController';

const controller = new ApiTimeEntryController();

export const POST = controller.startTracking();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';