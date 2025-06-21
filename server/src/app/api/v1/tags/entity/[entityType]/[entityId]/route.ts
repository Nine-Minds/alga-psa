/**
 * Entity Tags API Route
 * GET /api/v1/tags/entity/[entityType]/[entityId] - Get tags for entity
 * POST /api/v1/tags/entity/[entityType]/[entityId] - Tag entity
 * DELETE /api/v1/tags/entity/[entityType]/[entityId] - Remove tags from entity
 * PUT /api/v1/tags/entity/[entityType]/[entityId] - Replace entity tags
 */

import { CategoryTagController } from 'server/src/lib/api/controllers/CategoryTagController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new CategoryTagController();

export async function GET(request: Request, { params }: { params: { entityType: string; entityId: string } }) {
  try {
    const req = request as any;
    req.params = params;
    return await controller.getEntityTags()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request, { params }: { params: { entityType: string; entityId: string } }) {
  try {
    const req = request as any;
    req.params = params;
    return await controller.tagEntity()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request, { params }: { params: { entityType: string; entityId: string } }) {
  try {
    const req = request as any;
    req.params = params;
    return await controller.untagEntity()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: Request, { params }: { params: { entityType: string; entityId: string } }) {
  try {
    const req = request as any;
    req.params = params;
    return await controller.replaceEntityTags()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';