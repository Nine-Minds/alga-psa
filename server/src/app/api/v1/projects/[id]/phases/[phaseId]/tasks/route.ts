/**
 * Project Phase Tasks API Routes
 * GET /api/v1/projects/[id]/phases/[phaseId]/tasks - List phase tasks
 * POST /api/v1/projects/[id]/phases/[phaseId]/tasks - Create phase task
 */

import { ApiProjectController } from '@/lib/api/controllers/ApiProjectController';

const controller = new ApiProjectController();

export const GET = controller.listPhaseTasks();
export const POST = controller.createPhaseTask();
export const dynamic = 'force-dynamic';
