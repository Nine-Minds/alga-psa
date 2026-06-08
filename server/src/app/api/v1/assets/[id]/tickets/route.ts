/**
 * Asset Tickets API Route
 * Path: /api/v1/assets/[id]/tickets
 * GET  - List tickets linked to an asset
 * POST - Link a ticket to an asset
 */

import { ApiAssetController } from '@/lib/api/controllers/ApiAssetController';
import { handleApiError } from '@/lib/api/middleware/apiMiddleware';
import { withApiKeyRouteAuth } from '@/lib/api/middleware/withApiKeyRouteAuth';

const controller = new ApiAssetController();

export const GET = withApiKeyRouteAuth<{ id: string }>(async (request, { params }) => {
  try {
    const resolvedParams = await params;
    const req = request as any;
    req.params = resolvedParams;
    return await controller.listTickets(req, resolvedParams);
  } catch (error) {
    return handleApiError(error);
  }
});

export const POST = withApiKeyRouteAuth<{ id: string }>(async (request, { params }) => {
  try {
    const resolvedParams = await params;
    const req = request as any;
    req.params = resolvedParams;
    return await controller.linkTicket(req, resolvedParams);
  } catch (error) {
    return handleApiError(error);
  }
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
