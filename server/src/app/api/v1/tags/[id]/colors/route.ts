/**
 * Tag Colors API Route
 * PUT /api/v1/tags/[id]/colors - Update tag colors
 */

import { CategoryTagController } from 'server/src/lib/api/controllers/CategoryTagController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new CategoryTagController();

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  try {
    const req = request as any;
    req.params = params;
    return await controller.updateTagColors()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';