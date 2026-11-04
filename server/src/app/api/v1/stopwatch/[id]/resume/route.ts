/**
 * Stopwatch Resume API Route
 * POST /api/v1/stopwatch/{id}/resume - Resume the session
 */

import { ApiStopwatchController } from '@/lib/api/controllers/ApiStopwatchController';

const controller = new ApiStopwatchController();

export const POST = controller.resume();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
