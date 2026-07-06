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

import { emailSalesOrderConfirmation } from '@alga-psa/billing/actions';

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
    return new Response(JSON.stringify(result), {
      status: result.success ? 200 : 422,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to email the confirmation';
    const status = /permission denied/i.test(message) ? 403 : /not found/i.test(message) ? 404 : 400;
    return new Response(JSON.stringify({ success: false, recipients: [], error: message }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
