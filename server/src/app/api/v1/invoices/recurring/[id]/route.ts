/**
 * Recurring Invoice Template by ID API Route
 * PUT /api/v1/invoices/recurring/[id] - Update recurring invoice template
 * DELETE /api/v1/invoices/recurring/[id] - Delete recurring invoice template
 */

import { InvoiceController } from 'server/src/lib/api/controllers/InvoiceController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new InvoiceController();

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  try {
    const req = request as any;
    req.params = params;
    return await controller.updateRecurringTemplate()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  try {
    const req = request as any;
    req.params = params;
    return await controller.deleteRecurringTemplate()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';