/**
 * Project Phases API Routes
 * GET /api/v1/projects/{id}/phases - List project phases
 * POST /api/v1/projects/{id}/phases - Create project phase
 */

import { ProjectController } from 'server/src/lib/api/controllers/ProjectController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new ProjectController();

export async function GET(request: Request) {
  try {
    return await controller.listPhases()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    return await controller.createPhase()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';