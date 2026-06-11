/**
 * Contract Contract Line by ID API Routes
 * DELETE /api/v1/contracts/{contractId}/contract-lines/{contractLineId} - Detach a contract line from a contract
 */

import { ApiContractLineController } from '@/lib/api/controllers/ApiContractLineController';
import { handleApiError } from '@/lib/api/middleware/apiMiddleware';
import { withApiKeyRouteAuth } from '@/lib/api/middleware/withApiKeyRouteAuth';

const controller = new ApiContractLineController();

export const DELETE = withApiKeyRouteAuth<{ contractId: string; contractLineId: string }>(async (request, { params }) => {
  try {
    const resolvedParams = await params;
    const req = request as any;
    req.params = resolvedParams;
    return await controller.removeContractLine()(req, { params: Promise.resolve(resolvedParams) });
  } catch (error) {
    return handleApiError(error);
  }
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
