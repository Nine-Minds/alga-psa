/**
 * Client Contract Line by ID API Routes (DEPRECATED)
 * DELETE /api/v1/company-contract-lines/{id} - Unassign contract line from client
 *
 * @deprecated This endpoint is deprecated. Use /api/v1/client-contract-lines/{id} instead.
 *
 * This endpoint is maintained for backward compatibility during the company → client migration.
 * Please migrate to /api/v1/client-contract-lines/{id} as this endpoint will be removed in a future version.
 */

import { ApiContractLineController } from '@/lib/api/controllers/ApiContractLineController';
import { handleApiError } from '@/lib/api/middleware/apiMiddleware';
import { withApiKeyRouteAuth } from '@/lib/api/middleware/withApiKeyRouteAuth';

const controller = new ApiContractLineController();

export const DELETE = withApiKeyRouteAuth<{ id: string }>(async (request, { params }) => {
  try {
    const resolvedParams = await params;
    const req = request as any;
    req.params = resolvedParams;
    return await controller.unassignContractLineFromClient()(req, { params: Promise.resolve(resolvedParams) });
  } catch (error) {
    return handleApiError(error);
  }
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
