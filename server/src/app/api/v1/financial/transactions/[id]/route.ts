/**
 * Financial Transaction by ID API Route
 * GET /api/v1/financial/transactions/[id] - Get transaction by ID
 * PUT /api/v1/financial/transactions/[id] - Update transaction
 */

import { ApiFinancialController } from '@product/api/controllers/ApiFinancialController';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const controller = new ApiFinancialController();
  const req = request as any;
  req.params = params;
  return await controller.getTransactionById()(req);
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const controller = new ApiFinancialController();
  const req = request as any;
  req.params = params;
  return await controller.update()(req);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';