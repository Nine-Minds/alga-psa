/**
 * Tag Cloud API Route
 * GET /api/v1/tags/cloud - Get tag cloud
 */

import { CategoryTagController } from 'server/src/lib/api/controllers/CategoryTagController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new CategoryTagController();

export async function GET(request: Request) {
  try {
    return await controller.getTagCloud()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';