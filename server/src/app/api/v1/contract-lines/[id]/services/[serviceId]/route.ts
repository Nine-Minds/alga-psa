/**
 * Contract Line Service API Routes
 * Handles individual contract line service management operations
 */

import { NextRequest } from 'next/server';
import { ApiContractLineController } from 'server/src/lib/api/controllers/ApiContractLineController';
import { withApiKeyRouteAuth } from 'server/src/lib/api/middleware/withApiKeyRouteAuth';

const controller = new ApiContractLineController();

// GET /api/v1/contract-lines/[id]/services/[serviceId] - Get contract line service details
export const GET = withApiKeyRouteAuth(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string; serviceId: string }> }
) => {
  const resolvedParams = await params;
  (request as any).routeParams = { id: resolvedParams.id, serviceId: resolvedParams.serviceId };
  return controller.getContractLineServices()(request, { params: Promise.resolve({ id: resolvedParams.id }) });
});

// PUT /api/v1/contract-lines/[id]/services/[serviceId] - Update contract line service configuration
export const PUT = withApiKeyRouteAuth(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string; serviceId: string }> }
) => {
  const resolvedParams = await params;
  (request as any).routeParams = { id: resolvedParams.id, serviceId: resolvedParams.serviceId };
  return controller.updateContractLineService()(request, {
    params: Promise.resolve({ contractLineId: resolvedParams.id, serviceId: resolvedParams.serviceId }),
  });
});

// DELETE /api/v1/contract-lines/[id]/services/[serviceId] - Remove service from contract line
export const DELETE = withApiKeyRouteAuth(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string; serviceId: string }> }
) => {
  const resolvedParams = await params;
  (request as any).routeParams = { id: resolvedParams.id, serviceId: resolvedParams.serviceId };
  return controller.removeServiceFromContractLine()(request, {
    params: Promise.resolve({ contractLineId: resolvedParams.id, serviceId: resolvedParams.serviceId }),
  });
});
export const dynamic = 'force-dynamic';
