/**
 * Stopwatch Log API Route
 * POST /api/v1/stopwatch/{id}/log - Log the session as a time entry
 */

import { ApiStopwatchController } from '@/lib/api/controllers/ApiStopwatchController';

const controller = new ApiStopwatchController();

export const POST = controller.log();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
