/**
 * Tags Bulk Operations API Route
 * DELETE /api/v1/tags/bulk - Bulk delete tags
 * POST /api/v1/tags/bulk/merge - Bulk merge tags
 * POST /api/v1/tags/bulk/tag - Bulk tag entities
 * DELETE /api/v1/tags/bulk/untag - Bulk untag entities
 */

import { TagController } from 'server/src/lib/api/controllers/TagController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new TagController();

export async function DELETE(request: Request) {
  try {
    return await controller.bulkDeleteTags()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const url = new URL(request.url);
    if (url.pathname.endsWith('/merge')) {
      return await controller.bulkMergeTags()(request as any);
    } else if (url.pathname.endsWith('/tag')) {
      return await controller.bulkTagEntities()(request as any);
    } else if (url.pathname.endsWith('/untag')) {
      return await controller.bulkUntagEntities()(request as any);
    }
    return new Response('Not Found', { status: 404 });
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';