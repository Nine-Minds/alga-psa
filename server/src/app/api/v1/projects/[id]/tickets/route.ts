/**
 * Project Ticket Links API Routes
 * GET /api/v1/projects/{id}/tickets - List project ticket links
 * POST /api/v1/projects/{id}/tickets - Create project ticket link
 */

import { ProjectController } from 'server/src/lib/api/controllers/ProjectController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new ProjectController();

export async function GET(request: Request) {
  try {
    return await controller.listTicketLinks()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    return await controller.createTicketLink()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';