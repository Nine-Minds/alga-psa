/**
 * Financial Bulk Invoice Operations API Route
 * POST /api/v1/financial/bulk/invoices - Bulk invoice operations
 */

import { FinancialController } from 'server/src/lib/api/controllers/FinancialController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new FinancialController();

export async function POST(request: Request) {
  try {
    return await controller.bulkInvoiceOperations()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';