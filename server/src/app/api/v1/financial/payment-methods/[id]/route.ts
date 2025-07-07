/**
 * Financial Payment Method by ID API Route
 * GET /api/v1/financial/payment-methods/[id] - Get payment method by ID
 * PUT /api/v1/financial/payment-methods/[id] - Update payment method
 * DELETE /api/v1/financial/payment-methods/[id] - Delete payment method
 */

import { ApiFinancialControllerV2 } from 'server/src/lib/api/controllers/ApiFinancialControllerV2';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const controller = new ApiFinancialControllerV2();
  const req = request as any;
  req.params = params;
  return await controller.getById()(req);
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const controller = new ApiFinancialControllerV2();
  const req = request as any;
  req.params = params;
  return await controller.update()(req);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const controller = new ApiFinancialControllerV2();
  const req = request as any;
  req.params = params;
  return await controller.delete()(req);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';