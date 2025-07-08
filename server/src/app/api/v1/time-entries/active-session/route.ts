/**
 * Time Entry Active Session API Route
 * GET /api/v1/time-entries/active-session - Get active tracking session
 */

import { ApiTimeEntryController } from '@/lib/api/controllers/ApiTimeEntryController';

const controller = new ApiTimeEntryController();

export const GET = controller.getActiveSession();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';