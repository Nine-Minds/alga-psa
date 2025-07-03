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
  { params }: { params: Promise<{ id: string; phaseId: string }> }
) {
  const resolvedParams = await params;
  // Add route params to the request for controller access
  (request as any).routeParams = { id: resolvedParams.id, phaseId: resolvedParams.phaseId };
  
  return controller.updatePhase()(request);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; phaseId: string }> }
) {
  const resolvedParams = await params;
  // Add route params to the request for controller access
  (request as any).routeParams = { id: resolvedParams.id, phaseId: resolvedParams.phaseId };
  
  return controller.deletePhase()(request);
}
export const dynamic = 'force-dynamic';
