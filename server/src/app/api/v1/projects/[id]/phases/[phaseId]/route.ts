/**
 * Project Phase Detail API Routes
 * PUT /api/v1/projects/[id]/phases/[phaseId] - Update project phase
 * DELETE /api/v1/projects/[id]/phases/[phaseId] - Delete project phase
 */

import { NextRequest } from 'next/server';
import { ProjectController } from '../../../../../../../lib/api/controllers/ProjectController';

const controller = new ProjectController();

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string; phaseId: string } }
) {
  // Add route params to the request for controller access
  (request as any).routeParams = { id: params.id, phaseId: params.phaseId };
  
  return controller.updatePhase()(request);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string; phaseId: string } }
) {
  // Add route params to the request for controller access
  (request as any).routeParams = { id: params.id, phaseId: params.phaseId };
  
  return controller.deletePhase()(request);
}