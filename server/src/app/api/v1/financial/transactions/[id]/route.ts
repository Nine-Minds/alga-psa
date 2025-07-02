/**
 * Financial Transaction by ID API Route
 * GET /api/v1/financial/transactions/[id] - Get transaction by ID
 * PUT /api/v1/financial/transactions/[id] - Update transaction
 */

import { FinancialController } from 'server/src/lib/api/controllers/FinancialController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const controller = new FinancialController();
    const req = request as any;
    req.params = params;
    return await controller.getTransactionById()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const controller = new FinancialController();
    const req = request as any;
    req.params = params;
    return await controller.update()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';