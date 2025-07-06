/**
 * Project Phase Detail API Routes
 * PUT /api/v1/projects/[id]/phases/[phaseId] - Update project phase
 * DELETE /api/v1/projects/[id]/phases/[phaseId] - Delete project phase
 */

import { ApiProjectControllerV2 } from '@/lib/api/controllers/ApiProjectControllerV2';

const controller = new ApiProjectControllerV2();

export const PUT = controller.updatePhase();
export const DELETE = controller.deletePhase();
export const dynamic = 'force-dynamic';
