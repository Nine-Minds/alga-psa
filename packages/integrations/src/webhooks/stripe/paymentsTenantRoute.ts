import { NextRequest, NextResponse } from 'next/server';
import { handlePaymentsWebhookDelivery } from './payments';

/**
 * POST /api/webhooks/stripe/payments/[tenantId]
 *
 * Per-tenant Stripe payments endpoint. Tenant identity is fixed by the route;
 * the signature is verified against that tenant's endpoint secret only.
 * Unknown/disabled tenants (or tenants without a secret) get 404.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ tenantId: string }> | { tenantId: string } }) {
  const { tenantId } = await ctx.params;
  return handlePaymentsWebhookDelivery(req, 'tenant', tenantId);
}

export async function GET() {
  return NextResponse.json({ status: 'ok', purpose: 'invoice_payments', route: 'tenant' });
}
