/**
 * Project Phase Detail API Routes
 * PUT /api/v1/projects/[id]/phases/[phaseId] - Update project phase
 * DELETE /api/v1/projects/[id]/phases/[phaseId] - Delete project phase
 */

import { ApiProjectController } from '@/lib/api/controllers/ApiProjectController';

const controller = new ApiProjectController();

export const PUT = controller.updatePhase();
export const DELETE = controller.deletePhase();
export const dynamic = 'force-dynamic';
