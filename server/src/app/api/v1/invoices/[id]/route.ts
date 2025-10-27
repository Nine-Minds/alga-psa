/**
 * Invoice by ID API Route
 * GET /api/v1/invoices/[id] - Get invoice by ID
 * PUT /api/v1/invoices/[id] - Update invoice
 * DELETE /api/v1/invoices/[id] - Delete invoice
 */

import { ApiInvoiceController } from '@product/api/controllers/ApiInvoiceController';

const controller = new ApiInvoiceController();

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const req = request as any;
  req.params = params;
  return controller.getById()(req);
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const req = request as any;
  req.params = params;
  return controller.update()(req);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const req = request as any;
  req.params = params;
  return controller.delete()(req);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';