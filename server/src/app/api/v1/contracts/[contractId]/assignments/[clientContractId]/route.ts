/**
 * Contract Assignment Routes
 * GET|PUT|PATCH|DELETE /api/v1/contracts/{contractId}/assignments/{clientContractId}
 */

import { ApiContractLineController } from '@/lib/api/controllers/ApiContractLineController';
import { handleApiError } from '@/lib/api/middleware/apiMiddleware';
import { withApiKeyRouteAuth } from '@/lib/api/middleware/withApiKeyRouteAuth';

const controller = new ApiContractLineController();

export const GET = withApiKeyRouteAuth<{ contractId: string; clientContractId: string }>(async (request, { params }) => {
  try {
    const resolvedParams = await params;
    const req = request as any;
    req.params = resolvedParams;
    return await controller.getContractAssignment()(req, { params: Promise.resolve(resolvedParams) });
  } catch (error) {
    return handleApiError(error);
  }
});

export const PUT = withApiKeyRouteAuth<{ contractId: string; clientContractId: string }>(async (request, { params }) => {
  try {
    const resolvedParams = await params;
    const req = request as any;
    req.params = resolvedParams;
    return await controller.updateContractAssignment()(req, { params: Promise.resolve(resolvedParams) });
  } catch (error) {
    return handleApiError(error);
  }
});

export const PATCH = withApiKeyRouteAuth<{ contractId: string; clientContractId: string }>(async (request, { params }) => {
  try {
    const resolvedParams = await params;
    const req = request as any;
    req.params = resolvedParams;
    return await controller.updateContractAssignment()(req, { params: Promise.resolve(resolvedParams) });
  } catch (error) {
    return handleApiError(error);
  }
});

export const DELETE = withApiKeyRouteAuth<{ contractId: string; clientContractId: string }>(async (request, { params }) => {
  try {
    const resolvedParams = await params;
    const req = request as any;
    req.params = resolvedParams;
    return await controller.deleteContractAssignment()(req, { params: Promise.resolve(resolvedParams) });
  } catch (error) {
    return handleApiError(error);
  }
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
