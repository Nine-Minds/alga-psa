/**
 * Delete Tags by Text API Route
 * DELETE /api/v1/tags/by-text - Delete all tags with specific text and type
 */

import { TagController } from 'server/src/lib/api/controllers/TagController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

export async function DELETE(request: Request) {
  try {
    const controller = new TagController();
    return await controller.deleteTagsByText()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';