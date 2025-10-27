/**
 * Contract Line Service API Routes
 * Handles individual contract line service management operations
 */

import { NextRequest } from 'next/server';
import { ApiContractLineController } from '@product/api/controllers/ApiContractLineController';

const controller = new ApiContractLineController();

// GET /api/v1/contract-lines/[id]/services/[serviceId] - Get contract line service details
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; serviceId: string }> }
) {
  const resolvedParams = await params;
  // Add route params to the request for controller access
  (request as any).routeParams = { id: resolvedParams.id, serviceId: resolvedParams.serviceId };
  
  // This endpoint gets a specific service from the contract line's service list
  return controller.getContractLineServices()(request, { params: Promise.resolve({ id: resolvedParams.id }) });
}

// PUT /api/v1/contract-lines/[id]/services/[serviceId] - Update contract line service configuration
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; serviceId: string }> }
) {
  const resolvedParams = await params;
  // Add route params to the request for controller access
  (request as any).routeParams = { id: resolvedParams.id, serviceId: resolvedParams.serviceId };
  
  return controller.updateContractLineService()(request, { params: Promise.resolve({ contractLineId: resolvedParams.id, serviceId: resolvedParams.serviceId }) });
}

// DELETE /api/v1/contract-lines/[id]/services/[serviceId] - Remove service from contract line
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; serviceId: string }> }
) {
  const resolvedParams = await params;
  // Add route params to the request for controller access
  (request as any).routeParams = { id: resolvedParams.id, serviceId: resolvedParams.serviceId };
  
  return controller.removeServiceFromContractLine()(request, { params: Promise.resolve({ contractLineId: resolvedParams.id, serviceId: resolvedParams.serviceId }) });
}
export const dynamic = 'force-dynamic';
