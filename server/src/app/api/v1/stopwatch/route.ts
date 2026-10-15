/**
 * Stopwatch API Route
 * POST /api/v1/stopwatch - Start a stopwatch session
 */

import { ApiStopwatchController } from '@/lib/api/controllers/ApiStopwatchController';

const controller = new ApiStopwatchController();

export const POST = controller.start();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
