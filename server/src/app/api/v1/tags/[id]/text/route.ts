/**
 * Tag Text Update API Route
 * PUT /api/v1/tags/{id}/text - Update tag text
 */

import { CategoryTagController } from 'server/src/lib/api/controllers/CategoryTagController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

export async function PUT(request: Request) {
  try {
    const controller = new CategoryTagController();
    return await controller.updateTagText()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';