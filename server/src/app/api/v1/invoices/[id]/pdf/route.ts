/**
 * Invoice PDF Generation API Route
 * POST /api/v1/invoices/[id]/pdf - Generate PDF for invoice
 * GET /api/v1/invoices/[id]/pdf - Download PDF for invoice
 */

import { ApiInvoiceController } from '@product/api/controllers/ApiInvoiceController';

const controller = new ApiInvoiceController();

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const req = request as any;
  req.params = params;
  return controller.generatePDF()(req);
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const req = request as any;
  req.params = params;
  return controller.downloadPDF()(req);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';