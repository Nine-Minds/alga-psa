/**
 * Tag Colors API Route
 * PUT /api/v1/tags/[id]/colors - Update tag colors
 */

import { TagController } from 'server/src/lib/api/controllers/TagController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new TagController();

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
export const dynamic = 'force-dynamic';