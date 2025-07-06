/**
 * Project Phase Tasks API Routes
 * GET /api/v1/projects/[id]/phases/[phaseId]/tasks - List phase tasks
 */

import { ApiProjectControllerV2 } from '@/lib/api/controllers/ApiProjectControllerV2';

const controller = new ApiProjectControllerV2();

export const GET = controller.listPhaseTasks();
export const dynamic = 'force-dynamic';
