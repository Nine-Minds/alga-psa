/**
 * Sales Order — Email Confirmation API Route (session-authenticated)
 * POST /api/inventory/sales-orders/[id]/email-confirmation — email the Order Confirmation PDF to the
 * client (F205). Body (optional): { recipients?: string[], message?: string }.
 *
 * Lives under /api/inventory (session-cookie namespace, middleware-skipped from API-key auth) for the
 * same reasons as the document download route; auth is enforced in-handler by
 * emailSalesOrderConfirmation (withAuth + sales_order update permission). The route is in the server
 * app because the inventory package cannot depend on billing.
 */

import {
  emailSalesOrderConfirmation,
  SalesOrderDocumentError,
} from '@alga-psa/billing/actions';

function salesOrderEmailError(error: unknown): { status: number; message: string } {
  if (error instanceof SalesOrderDocumentError) {
    if (error.code === 'permission_denied') {
      return { status: 403, message: error.message };
    }
    if (error.code === 'not_found') {
      return { status: 404, message: error.message };
    }
    return { status: 422, message: error.message };
  }
  const message = error instanceof Error ? error.message : '';
  if (/permission denied/i.test(message)) {
    return { status: 403, message: 'You do not have permission to email sales order documents.' };
  }
  if (/not found/i.test(message)) {
    return { status: 404, message: 'Sales order not found.' };
  }
  return { status: 500, message: 'Failed to email the confirmation.' };
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: { recipients?: string[]; message?: string } = {};
  try {
    body = await request.json();
  } catch {
    /* empty / non-JSON body — send to the client's on-file billing email */
  }
  try {
    const result = await emailSalesOrderConfirmation(id, {
      recipients: Array.isArray(body?.recipients) ? body.recipients : undefined,
      message: typeof body?.message === 'string' ? body.message : undefined,
    });
    const status = result.success
      ? 200
      : /permission denied/i.test(result.error ?? '')
        ? 403
        : /not found/i.test(result.error ?? '')
          ? 404
          : 422;
    return new Response(JSON.stringify(result), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const { status, message } = salesOrderEmailError(error);
    return new Response(JSON.stringify({ success: false, recipients: [], error: message }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
