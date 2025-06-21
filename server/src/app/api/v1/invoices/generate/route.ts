/**
 * Invoice Generation API Route
 * POST /api/v1/invoices/generate - Generate invoice from billing cycle
 */

import { InvoiceController } from 'server/src/lib/api/controllers/InvoiceController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new InvoiceController();

export async function POST(request: Request) {
  try {
    return await controller.generateFromBillingCycle()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';