/**
 * Recurring Invoice Template by ID API Route
 * PUT /api/v1/invoices/recurring/[id] - Update recurring invoice template
 * DELETE /api/v1/invoices/recurring/[id] - Delete recurring invoice template
 */

import { ApiInvoiceController } from '@product/api/controllers/ApiInvoiceController';

const controller = new ApiInvoiceController();

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const req = request as any;
  req.params = params;
  return controller.updateRecurringTemplate()(req);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const req = request as any;
  req.params = params;
  return controller.deleteRecurringTemplate()(req);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';