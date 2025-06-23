/**
 * Invoice PDF Generation API Route
 * POST /api/v1/invoices/[id]/pdf - Generate PDF for invoice
 * GET /api/v1/invoices/[id]/pdf - Download PDF for invoice
 */

import { InvoiceController } from 'server/src/lib/api/controllers/InvoiceController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new InvoiceController();

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const req = request as any;
    req.params = params;
    return await controller.generatePDF()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const req = request as any;
    req.params = params;
    return await controller.downloadPDF()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';