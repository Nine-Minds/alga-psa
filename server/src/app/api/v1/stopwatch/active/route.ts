/**
 * Stopwatch Active Session API Route
 * GET /api/v1/stopwatch/active - Get the open stopwatch session (or null)
 */

import { ApiStopwatchController } from '@/lib/api/controllers/ApiStopwatchController';

const controller = new ApiStopwatchController();

export const GET = controller.getActive();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
