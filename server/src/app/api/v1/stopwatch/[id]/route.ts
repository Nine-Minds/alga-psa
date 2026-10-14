/**
 * Stopwatch Session API Route
 * PATCH  /api/v1/stopwatch/{id} - Update notes / service of the open session
 * DELETE /api/v1/stopwatch/{id} - Discard the session
 */

import { ApiStopwatchController } from '@/lib/api/controllers/ApiStopwatchController';

const controller = new ApiStopwatchController();

export const PATCH = controller.updateDraft();
export const DELETE = controller.discard();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
