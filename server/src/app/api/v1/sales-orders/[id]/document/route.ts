/**
 * Sales Order Document API Route
 * GET /api/v1/sales-orders/[id]/document — download the Sales Order document (Order Confirmation) PDF.
 *
 * Lives in the server app because the inventory package (where the Sales Orders screen lives) cannot
 * depend on billing (billing depends on inventory). The browser hits this URL to download the PDF.
 */

import { downloadSalesOrderPDF } from '@alga-psa/billing/actions';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const { pdfData, soNumber } = await downloadSalesOrderPDF(id);
    const body = new Uint8Array(pdfData);
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${soNumber || id}.pdf"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to generate the document';
    const status = /permission denied/i.test(message) ? 403 : /not found/i.test(message) ? 404 : 400;
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
