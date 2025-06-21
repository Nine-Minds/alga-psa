/**
 * Billing Plan Service API Routes
 * Handles individual billing plan service management operations
 */

import { NextRequest } from 'next/server';
import { BillingPlanController } from '../../../../lib/api/controllers/BillingPlanController';

const controller = new BillingPlanController();

// GET /api/v1/billing-plans/[id]/services/[serviceId] - Get billing plan service details
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string; serviceId: string } }
) {
  const searchParams = request.nextUrl.searchParams;
  const modifiedRequest = new NextRequest(request, {
    ...request,
    nextUrl: new URL(`${request.nextUrl.pathname}?${searchParams.toString()}`, request.nextUrl.origin)
  });
  
  // Add route params to the request for controller access
  (modifiedRequest as any).routeParams = { id: params.id, serviceId: params.serviceId };
  
  return controller.getBillingPlanService()(modifiedRequest);
}

// PUT /api/v1/billing-plans/[id]/services/[serviceId] - Update billing plan service configuration
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string; serviceId: string } }
) {
  // Add route params to the request for controller access
  (request as any).routeParams = { id: params.id, serviceId: params.serviceId };
  
  return controller.updateBillingPlanService()(request);
}

// DELETE /api/v1/billing-plans/[id]/services/[serviceId] - Remove service from billing plan
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string; serviceId: string } }
) {
  // Add route params to the request for controller access
  (request as any).routeParams = { id: params.id, serviceId: params.serviceId };
  
  return controller.removeBillingPlanService()(request);
}