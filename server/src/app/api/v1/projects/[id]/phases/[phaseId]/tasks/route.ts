/**
 * Project Phase Tasks API Routes
 * POST /api/v1/projects/[id]/phases/[phaseId]/tasks - Create project task
 */

import { NextRequest } from 'next/server';
import { ProjectController } from '../../../../../../../../lib/api/controllers/ProjectController';

const controller = new ProjectController();

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string; phaseId: string } }
) {
  // Add route params to the request for controller access
  (request as any).routeParams = { id: params.id, phaseId: params.phaseId };
  
  return controller.createTask()(request);
}