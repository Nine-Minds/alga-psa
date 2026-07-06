/**
 * Sales Order Document API Route (session-authenticated)
 * GET /api/inventory/sales-orders/[id]/document — download the Sales Order document (Order
 * Confirmation) PDF for the browser.
 *
 * Lives under /api/inventory (NOT /api/v1, which is the external API-key namespace) and is added to
 * the middleware API-key skip-list, so the browser's session cookie reaches the handler. Auth is
 * enforced in-handler by downloadSalesOrderPDF (withAuth + sales_order read permission). The route
 * is here (server app) because the inventory package cannot depend on billing.
 */

import { downloadSalesOrderPDF, type SalesOrderDocumentType } from '@alga-psa/billing/actions';

const VALID_TYPES: SalesOrderDocumentType[] = ['sales-order', 'packing-slip', 'pick-list'];

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const typeParam = new URL(request.url).searchParams.get('type');
  const documentType: SalesOrderDocumentType =
    typeParam && (VALID_TYPES as string[]).includes(typeParam) ? (typeParam as SalesOrderDocumentType) : 'sales-order';
  try {
    const { pdfData, soNumber } = await downloadSalesOrderPDF(id, documentType);
    const body = new Uint8Array(pdfData);
    const suffix = documentType === 'sales-order' ? '' : `-${documentType}`;
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${soNumber || id}${suffix}.pdf"`,
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
