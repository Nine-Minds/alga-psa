/**
 * Project Phase Tasks API Routes
 * GET /api/v1/projects/[id]/phases/[phaseId]/tasks - List phase tasks
 */

import { ApiProjectController } from '@/lib/api/controllers/ApiProjectController';

const controller = new ApiProjectController();

export const GET = controller.listPhaseTasks();
export const dynamic = 'force-dynamic';
