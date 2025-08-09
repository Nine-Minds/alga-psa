/**
 * Billing Plan Service API Routes
 * Handles individual billing plan service management operations
 */

import { NextRequest } from 'next/server';
import { ApiBillingPlanController } from 'server/src/lib/api/controllers/ApiBillingPlanController';

const controller = new ApiBillingPlanController();

// GET /api/v1/billing-plans/[id]/services/[serviceId] - Get billing plan service details
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; serviceId: string }> }
) {
  const resolvedParams = await params;
  // Add route params to the request for controller access
  (request as any).routeParams = { id: resolvedParams.id, serviceId: resolvedParams.serviceId };
  
  // This endpoint gets a specific service from the plan's service list
  return controller.getPlanServices()(request, resolvedParams);
}

// PUT /api/v1/billing-plans/[id]/services/[serviceId] - Update billing plan service configuration
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; serviceId: string }> }
) {
  const resolvedParams = await params;
  // Add route params to the request for controller access
  (request as any).routeParams = { id: resolvedParams.id, serviceId: resolvedParams.serviceId };
  
  return controller.updatePlanService()(request, { planId: resolvedParams.id, serviceId: resolvedParams.serviceId });
}

// DELETE /api/v1/billing-plans/[id]/services/[serviceId] - Remove service from billing plan
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; serviceId: string }> }
) {
  const resolvedParams = await params;
  // Add route params to the request for controller access
  (request as any).routeParams = { id: resolvedParams.id, serviceId: resolvedParams.serviceId };
  
  return controller.removeServiceFromPlan()(request, { planId: resolvedParams.id, serviceId: resolvedParams.serviceId });
}
export const dynamic = 'force-dynamic';
