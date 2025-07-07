/**
 * Recurring Invoice Template by ID API Route
 * PUT /api/v1/invoices/recurring/[id] - Update recurring invoice template
 * DELETE /api/v1/invoices/recurring/[id] - Delete recurring invoice template
 */

import { ApiInvoiceControllerV2 } from 'server/src/lib/api/controllers/ApiInvoiceControllerV2';

const controller = new ApiInvoiceControllerV2();

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