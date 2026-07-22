import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';

import { createTenantKnex, tenantDb } from '@alga-psa/db';
import logger from '@alga-psa/core/logger';
import { recordExternalPayment } from '@alga-psa/billing/services/accountingSync/recordExternalPayment';
import { isEnterpriseEdition } from 'server/src/lib/features';

const PROVIDER = 'alternative_payments';
const SUCCESS_STATUSES = new Set(['paid', 'completed', 'succeeded', 'success']);

type JsonRecord = Record<string, any>;

function getNested(payload: JsonRecord, path: string[]): any {
  let current: any = payload;
  for (const key of path) {
    if (!current || typeof current !== 'object') {
      return undefined;
    }
    current = current[key];
  }
  return current;
}

function firstValue(payload: JsonRecord, paths: string[][]): any {
  for (const path of paths) {
    const value = getNested(payload, path);
    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
  }
  return undefined;
}

function extractTenantId(req: NextRequest, payload: JsonRecord): string | null {
  return (
    req.headers.get('x-tenant-id') ||
    firstValue(payload, [
      ['tenant_id'],
      ['tenantId'],
      ['data', 'tenant_id'],
      ['data', 'tenantId'],
      ['metadata', 'tenant_id'],
      ['metadata', 'tenantId'],
      ['data', 'metadata', 'tenant_id'],
      ['data', 'metadata', 'tenantId'],
    ]) ||
    null
  );
}

function extractEventId(payload: JsonRecord): string | null {
  return (
    firstValue(payload, [
      ['event_id'],
      ['eventId'],
      ['id'],
      ['data', 'event_id'],
      ['data', 'eventId'],
      ['data', 'id'],
    ]) || null
  );
}

function extractInvoiceId(payload: JsonRecord): string | null {
  return (
    firstValue(payload, [
      ['invoice_id'],
      ['invoiceId'],
      ['data', 'invoice_id'],
      ['data', 'invoiceId'],
      ['metadata', 'invoice_id'],
      ['metadata', 'invoiceId'],
      ['data', 'metadata', 'invoice_id'],
      ['data', 'metadata', 'invoiceId'],
    ]) || null
  );
}

function extractStatus(payload: JsonRecord): string | null {
  const status = firstValue(payload, [
    ['status'],
    ['payment_status'],
    ['paymentStatus'],
    ['data', 'status'],
    ['data', 'payment_status'],
    ['data', 'paymentStatus'],
  ]);
  return status ? String(status).toLowerCase() : null;
}

function extractEventType(payload: JsonRecord): string {
  return String(firstValue(payload, [
    ['event_type'],
    ['eventType'],
    ['type'],
    ['data', 'event_type'],
    ['data', 'eventType'],
    ['data', 'type'],
  ]) || 'payment.updated');
}

function extractAmountCents(payload: JsonRecord): number | null {
  const amount = firstValue(payload, [
    ['amount_cents'],
    ['amountCents'],
    ['amount_in_cents'],
    ['amountInCents'],
    ['data', 'amount_cents'],
    ['data', 'amountCents'],
    ['data', 'amount_in_cents'],
    ['data', 'amountInCents'],
  ]);

  const parsed = Number(amount);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;
}

function extractCurrency(payload: JsonRecord): string | undefined {
  const currency = firstValue(payload, [
    ['currency'],
    ['data', 'currency'],
    ['payment', 'currency'],
    ['data', 'payment', 'currency'],
  ]);
  return currency ? String(currency).toUpperCase() : undefined;
}

function extractReferenceNumber(payload: JsonRecord, eventId: string): string {
  return String(firstValue(payload, [
    ['payment_id'],
    ['paymentId'],
    ['transaction_id'],
    ['transactionId'],
    ['data', 'payment_id'],
    ['data', 'paymentId'],
    ['data', 'transaction_id'],
    ['data', 'transactionId'],
  ]) || eventId);
}

function timingSafeEqualHex(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function verifySignature(body: string, signature: string | null): boolean {
  const secret = process.env.ALTERNATIVE_PAYMENTS_WEBHOOK_SECRET;
  if (!secret) {
    // Fail closed: without a configured secret the request cannot be
    // authenticated. This endpoint records payments against an
    // attacker-supplied tenant/invoice, so an unsigned request must never be
    // trusted (previously this returned true, allowing unauthenticated
    // cross-tenant payment fraud).
    console.error('[alternative-payments webhook] ALTERNATIVE_PAYMENTS_WEBHOOK_SECRET is not configured; rejecting webhook');
    return false;
  }

  if (!signature) {
    return false;
  }

  const normalized = signature.startsWith('sha256=')
    ? signature.slice('sha256='.length)
    : signature;
  const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
  return timingSafeEqualHex(normalized, expected);
}

async function insertWebhookEvent(knex: any, tenant: string, eventId: string, eventType: string, payload: JsonRecord) {
  const hasTable = await knex.schema.hasTable('payment_webhook_events');
  if (!hasTable) {
    return { inserted: true, eventRecordId: null };
  }

  const inserted = await tenantDb(knex, tenant).table('payment_webhook_events')
    .insert({
      tenant,
      provider_type: PROVIDER,
      external_event_id: eventId,
      event_type: eventType,
      event_data: JSON.stringify(payload),
      processed: false,
      processing_status: 'pending',
    })
    .onConflict(['tenant', 'provider_type', 'external_event_id'])
    .ignore()
    .returning('event_id');

  return {
    inserted: inserted.length > 0,
    eventRecordId: inserted[0]?.event_id ?? null,
  };
}

async function updateWebhookEvent(knex: any, tenant: string, eventId: string, status: 'completed' | 'failed') {
  const hasTable = await knex.schema.hasTable('payment_webhook_events');
  if (!hasTable) {
    return;
  }

  await tenantDb(knex, tenant).table('payment_webhook_events')
    .where({ provider_type: PROVIDER, external_event_id: eventId })
    .update({
      processed: status === 'completed',
      processing_status: status,
      processed_at: knex.fn.now(),
    });
}

export async function POST(req: NextRequest) {
  // External payment recording is Enterprise Edition functionality — it lands
  // in invoice_payments, which only the EE migration chain creates. Cloud SaaS
  // reports 'enterprise' too, so this only blocks CE self-hosts.
  if (!isEnterpriseEdition()) {
    return NextResponse.json(
      { error: 'The alternative-payments webhook is Enterprise Edition functionality.' },
      { status: 403 },
    );
  }

  const body = await req.text();
  const signature = req.headers.get('x-alternative-payments-signature')
    || req.headers.get('x-ap-signature')
    || req.headers.get('x-webhook-signature');

  if (!verifySignature(body, signature)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let payload: JsonRecord;
  try {
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  const tenant = extractTenantId(req, payload);
  const eventId = extractEventId(payload);
  const eventType = extractEventType(payload);
  const status = extractStatus(payload);
  const invoiceId = extractInvoiceId(payload);
  const amount = extractAmountCents(payload);

  if (!tenant || !eventId) {
    return NextResponse.json({ error: 'Missing tenant_id or event_id' }, { status: 400 });
  }

  const { knex } = await createTenantKnex(tenant);
  const webhookEvent = await insertWebhookEvent(knex, tenant, eventId, eventType, payload);

  if (!webhookEvent.inserted) {
    return NextResponse.json({
      received: true,
      processed: true,
      eventId,
      duplicate: true,
    });
  }

  if (!status || !SUCCESS_STATUSES.has(status)) {
    await updateWebhookEvent(knex, tenant, eventId, 'completed');
    return NextResponse.json({
      received: true,
      processed: false,
      eventId,
      reason: 'non_success_status',
      status,
    });
  }

  if (!invoiceId || !amount) {
    await updateWebhookEvent(knex, tenant, eventId, 'failed');
    return NextResponse.json({ error: 'Missing invoice_id or amount_cents' }, { status: 400 });
  }

  const result = await recordExternalPayment(knex, tenant, {
    invoiceId,
    amount,
    provider: PROVIDER,
    referenceNumber: extractReferenceNumber(payload, eventId),
    currency: extractCurrency(payload),
    paymentDate: new Date(),
    notes: `Alternative Payments webhook ${eventId}`,
    transactionMetadata: {
      provider_event_id: eventId,
      provider_event_type: eventType,
    },
  });

  await updateWebhookEvent(knex, tenant, eventId, result.success ? 'completed' : 'failed');

  if (!result.success) {
    logger.warn('[Alternative Payments Webhook] payment processing failed', { tenant, eventId, error: result.error });
    return NextResponse.json({
      received: true,
      processed: false,
      eventId,
      error: result.error,
    });
  }

  return NextResponse.json({
    received: true,
    processed: true,
    eventId,
    paymentRecorded: result.paymentRecorded,
    paymentId: result.paymentId,
    invoiceId,
  });
}

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    provider: PROVIDER,
    message: 'Alternative Payments webhook endpoint is active',
    signature: process.env.ALTERNATIVE_PAYMENTS_WEBHOOK_SECRET ? 'configured' : 'not_configured',
    timestamp: new Date().toISOString(),
  });
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
