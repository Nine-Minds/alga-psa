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
import { isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';

const VALID_TYPES: SalesOrderDocumentType[] = ['sales-order', 'packing-slip', 'pick-list'];

function salesOrderDocumentError(error: unknown): { status: number; message: string } {
  if (isActionPermissionError(error)) {
    return { status: 403, message: 'You do not have permission to download sales order documents.' };
  }
  if (isActionMessageError(error)) {
    return { status: /not found/i.test(error.actionError) ? 404 : 422, message: error.actionError };
  }
  const message = error instanceof Error ? error.message : '';
  if (/permission denied/i.test(message)) {
    return { status: 403, message: 'You do not have permission to download sales order documents.' };
  }
  if (/not found/i.test(message)) {
    return { status: 404, message: 'Sales order not found.' };
  }
  return { status: 500, message: 'Failed to generate the document.' };
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const typeParam = new URL(request.url).searchParams.get('type');
  const documentType: SalesOrderDocumentType =
    typeParam && (VALID_TYPES as string[]).includes(typeParam) ? (typeParam as SalesOrderDocumentType) : 'sales-order';
  try {
    const result = await downloadSalesOrderPDF(id, documentType);
    if (isActionPermissionError(result) || isActionMessageError(result)) {
      const { status, message } = salesOrderDocumentError(result);
      return new Response(JSON.stringify({ error: message }), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { pdfData, soNumber } = result;
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
    const { status, message } = salesOrderDocumentError(error);
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
