/**
 * Recurring Invoice Templates API Route
 * GET /api/v1/invoices/recurring - List recurring invoice templates
 * POST /api/v1/invoices/recurring - Create recurring invoice template
 */

import { InvoiceController } from 'server/src/lib/api/controllers/InvoiceController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new InvoiceController();

export async function GET(request: Request) {
  try {
    return await controller.listRecurringTemplates()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    return await controller.createRecurringTemplate()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';