/**
 * Stopwatch Pause API Route
 * POST /api/v1/stopwatch/{id}/pause - Pause the session
 */

import { ApiStopwatchController } from '@/lib/api/controllers/ApiStopwatchController';

const controller = new ApiStopwatchController();

export const POST = controller.pause();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
