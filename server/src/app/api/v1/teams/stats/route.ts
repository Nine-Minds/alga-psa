/**
 * Teams Statistics API Route
 * GET /api/v1/teams/stats - Get team statistics
 */

import { TeamController } from 'server/src/lib/api/controllers/TeamController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new TeamController();

export async function GET(request: Request) {
  try {
    return await controller.list()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';