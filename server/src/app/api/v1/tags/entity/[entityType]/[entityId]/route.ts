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

export async function GET(request: Request, { params }: { params: Promise<{ entityType: string; entityId: string }> }) {
  try {
    const resolvedParams = await params;
    const req = request as any;
    req.params = resolvedParams;
    return await controller.list()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ entityType: string; entityId: string }> }) {
  try {
    const resolvedParams = await params;
    const req = request as any;
    req.params = resolvedParams;
    return await controller.create()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ entityType: string; entityId: string }> }) {
  try {
    const resolvedParams = await params;
    const req = request as any;
    req.params = resolvedParams;
    return await controller.delete()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ entityType: string; entityId: string }> }) {
  try {
    const resolvedParams = await params;
    const req = request as any;
    req.params = resolvedParams;
    return await controller.update()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';