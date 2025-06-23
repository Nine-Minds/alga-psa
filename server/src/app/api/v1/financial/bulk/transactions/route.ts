/**
 * Financial Bulk Transaction Operations API Route
 * POST /api/v1/financial/bulk/transactions - Bulk transaction operations
 */

import { FinancialController } from 'server/src/lib/api/controllers/FinancialController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

export async function POST(request: Request) {
  try {
    const financialController = new FinancialController();
    return await financialController.bulkInvoiceOperations()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';