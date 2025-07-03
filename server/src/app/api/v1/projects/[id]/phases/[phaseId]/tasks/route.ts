/**
 * Project Phase Tasks API Routes
 * POST /api/v1/projects/[id]/phases/[phaseId]/tasks - Create project task
 */

import { NextRequest } from 'next/server';
import { ProjectController } from '../../../../../../../../lib/api/controllers/ProjectController';

const controller = new ProjectController();

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; phaseId: string }> }
) {
  const resolvedParams = await params;
  // Add route params to the request for controller access
  (request as any).routeParams = { id: resolvedParams.id, phaseId: resolvedParams.phaseId };
  
  return controller.createTask()(request);
}
export const dynamic = 'force-dynamic';
