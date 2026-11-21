import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import logger from '@alga-psa/core/logger';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { tenantDb } from '@alga-psa/db';
import type { WebhookProcessingResult } from '@alga-psa/types';
import {
  extractTenantId,
  peekTenantId,
  resolveSignatureCandidates,
  verifyStripeSignature,
  type WebhookSecretSource,
} from './paymentsSignature';
import { isStripeTenantEnabled, listEnabledStripeTenants } from './paymentsTenants';

// One shared dynamic import for the dispatch path and the background migration trigger.
let enterprisePaymentsModule: Promise<any> | null = null;
function importEnterprisePayments(): Promise<any> {
  enterprisePaymentsModule ??= import('@enterprise/lib/payments').catch((error) => {
    enterprisePaymentsModule = null; // do not cache a failed import
    throw error;
  });
  return enterprisePaymentsModule;
}

async function loadEnterprisePayments(): Promise<{
  PaymentService: any;
  createStripePaymentProvider: any;
} | null> {
  try {
    const mod = await importEnterprisePayments();
    return {
      PaymentService: (mod as any).PaymentService,
      createStripePaymentProvider: (mod as any).createStripePaymentProvider,
    };
  } catch (error) {
    logger.debug('[Stripe Payment Webhook] enterprise payments module not available', { error });
    return null;
  }
}

/**
 * Fire-and-forget: ask the EE module to move tenant T's Stripe endpoint to the
 * per-tenant URL. Never awaited by the caller and never throws; the dynamic
 * import is part of the background work. The handler knows nothing about
 * Stripe endpoint APIs.
 */
function scheduleEndpointMigration(tenantId: string): void {
  void (async () => {
    try {
      const mod = await importEnterprisePayments();
      await (mod as any).migrateStripeWebhookEndpointOnDemand?.(tenantId);
    } catch (error) {
      logger.warn('[Stripe Payment Webhook] on-demand endpoint migration trigger failed', {
        tenantId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  })();
}

/**
 * POST /api/webhooks/stripe/payments
 *
 * Stripe webhook endpoint for processing invoice payment events.
 * This is separate from the license management webhook at /api/webhooks/stripe.
 *
 * Events handled:
 * - checkout.session.completed: Payment completed via Checkout
 * - payment_intent.succeeded: Payment intent succeeded
 * - payment_intent.payment_failed: Payment failed
 * - checkout.session.expired: Checkout session expired
 *
 * Legacy shared endpoint. New endpoints are registered per tenant at
 * /api/webhooks/stripe/payments/[tenantId]; this route stays live through migration.
 *
 * Security:
 * - Verifies the Stripe signature against the hint tenant's secret, then every
 *   enabled tenant's endpoint secret, then the platform secret.
 *   See paymentsSignature.ts and handlePaymentsWebhookDelivery.
 * - Uses payment_webhook_events table for idempotency
 *
 * Configuration:
 * - Tenant-connected accounts: the endpoint and its signing secret are created
 *   automatically by the payment settings connect flow (payment-actions.ts).
 * - Platform account: store the endpoint signing secret as the app secret
 *   `stripe_payment_webhook_secret` (or `stripe_webhook_secret`) in the secret
 *   provider (Vault in hosted environments).
 */

async function hasPlatformWebhookSecret(): Promise<boolean> {
  const secretProvider = await getSecretProviderInstance();
  const candidates = await resolveSignatureCandidates(secretProvider, {});
  return candidates.length > 0;
}

type DeliveryRoute = 'legacy' | 'tenant';
type DeliveryOutcome =
  | 'dispatched' | 'dispatch_failed' | 'license_order' | 'ignored_tenant_mismatch'
  | 'ignored_platform_event' | 'invalid_signature' | 'malformed' | 'missing_signature'
  | 'unknown_tenant' | 'no_candidates' | 'error';

function logDelivery(fields: {
  route: DeliveryRoute;
  tenantId: string | null;
  secretSource: WebhookSecretSource | null;
  outcome: DeliveryOutcome;
  eventType?: string | null;
  eventId?: string | null;
}, level: 'info' | 'warn' | 'error' = 'info') {
  logger[level]('[Stripe Payment Webhook] delivery', {
    route: fields.route,
    tenantId: fields.tenantId,
    secretSource: fields.secretSource,
    outcome: fields.outcome,
    eventType: fields.eventType ?? null,
    eventId: fields.eventId ?? null,
  });
}

/**
 * Shared delivery handler for the legacy shared route and the per-tenant route.
 *
 * Tenant identity comes from the route (per-tenant) or from whichever tenant's
 * secret verified the signature (legacy) -- never from unverified payload
 * metadata. 401 means only that the signature failed.
 *
 * Outcomes for a verified event:
 * - license order (platform account): license workflow.
 * - signed by tenant T but metadata.tenant_id names another tenant: 200 ignored.
 * - signed by tenant T (tagged or untagged): dispatched to T. Untagged events
 *   are dispatched too because several handled types (payment_method.*,
 *   setup_intent.*, charge.refunded) are matched by Stripe IDs in T's own
 *   tables, not by metadata; T's dispatcher ignores what it cannot match.
 * - signed by the platform secret (legacy route only; the platform secret is
 *   trusted, as before): license order -> license handler; carries
 *   metadata.tenant_id -> dispatched to that tenant (single-account and
 *   dev/e2e emulator deployments); no tenant_id -> 200 ignored.
 * The per-tenant route accepts only that tenant's own secret.
 */
export async function handlePaymentsWebhookDelivery(
  req: NextRequest,
  route: DeliveryRoute,
  tenantIdFromRoute?: string
): Promise<NextResponse> {
  const startTime = Date.now();

  if (process.env.NEXT_PUBLIC_EDITION !== 'enterprise') {
    logger.warn('[Stripe Payment Webhook] Only available in Enterprise Edition');
    return NextResponse.json(
      { error: 'Stripe integration is only available in Enterprise Edition' },
      { status: 404 }
    );
  }

  let eventId: string | null = null;
  let eventType: string | null = null;
  try {
    if (route === 'tenant' && (!tenantIdFromRoute || !(await isStripeTenantEnabled(tenantIdFromRoute)))) {
      logDelivery({ route, tenantId: null, secretSource: null, outcome: 'unknown_tenant' }, 'warn');
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const body = await req.text();
    const signature = req.headers.get('stripe-signature');
    if (!signature) {
      logDelivery({ route, tenantId: tenantIdFromRoute ?? null, secretSource: null, outcome: 'missing_signature' }, 'warn');
      return NextResponse.json({ error: 'Missing stripe-signature header' }, { status: 400 });
    }

    const secretProvider = await getSecretProviderInstance();
    const candidates = await resolveSignatureCandidates(
      secretProvider,
      route === 'tenant'
        ? { tenantIdFromRoute }
        : { payloadTenantHint: peekTenantId(body), enabledTenantIds: await listEnabledStripeTenants() }
    );

    if (candidates.length === 0) {
      if (route === 'tenant') {
        // Enabled tenant without a stored endpoint secret: nothing to verify against.
        logDelivery({ route, tenantId: tenantIdFromRoute ?? null, secretSource: null, outcome: 'unknown_tenant' }, 'warn');
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
      logDelivery({ route, tenantId: null, secretSource: null, outcome: 'no_candidates' }, 'error');
      return NextResponse.json({ error: 'Webhook configuration error' }, { status: 503 });
    }

    const result = verifyStripeSignature(body, signature, candidates);
    if (result.kind === 'invalid') {
      logDelivery({ route, tenantId: tenantIdFromRoute ?? null, secretSource: null, outcome: 'invalid_signature' }, 'error');
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    // Single trigger site, before any outcome branch. Legacy route only, and only
    // when a tenant's own endpoint secret verified (so the endpoint provably
    // belongs to that tenant): covers dispatched, dispatch_failed,
    // ignored_tenant_mismatch and malformed-but-verified (the move is URL-only
    // and independent of the payload). Never for platform / route-tenant secrets.
    if (
      route === 'legacy' &&
      result.tenantId &&
      (result.secretSource === 'hint-tenant' || result.secretSource === 'tenant')
    ) {
      scheduleEndpointMigration(result.tenantId);
    }

    const event: Stripe.Event = result.event;
    eventId = event.id ?? null;
    eventType = event.type ?? null;
    const secretSource = result.secretSource;

    if (!event.id || !event.type || !event.data?.object) {
      logDelivery({ route, tenantId: result.tenantId, secretSource, outcome: 'malformed', eventId, eventType }, 'warn');
      return NextResponse.json({ error: 'Malformed event' }, { status: 400 });
    }

    if (result.kind === 'ignored') {
      logDelivery({ route, tenantId: result.tenantId, secretSource, outcome: 'ignored_tenant_mismatch', eventId, eventType }, 'warn');
      return NextResponse.json({ received: true, processed: false, status: 'ignored', reason: result.reason });
    }

    // Platform-secret deliveries (legacy route only; the platform secret is trusted).
    let dispatchTenantId = result.tenantId;
    if (dispatchTenantId === null) {
      if (isLicenseOrderEvent(event)) {
        const licenseResult = await handleLicenseOrderWebhook(event);
        logDelivery({ route, tenantId: null, secretSource, outcome: 'license_order', eventId, eventType });
        return NextResponse.json({
          received: true,
          processed: licenseResult.success,
          purpose: 'license_order',
          processingTimeMs: Date.now() - startTime,
          ...(licenseResult.error ? { error: licenseResult.error } : {}),
        });
      }
      dispatchTenantId = extractTenantId(event);
      if (!dispatchTenantId) {
        logDelivery({ route, tenantId: null, secretSource, outcome: 'ignored_platform_event', eventId, eventType });
        return NextResponse.json({ received: true, processed: false, status: 'ignored', reason: 'no_tenant_id' });
      }
    }

    const processed = await processStripePaymentWebhookPayload(dispatchTenantId, body);
    const processingTimeMs = Date.now() - startTime;
    if (processed.success) {
      logDelivery({ route, tenantId: dispatchTenantId, secretSource, outcome: 'dispatched', eventId, eventType });
      return NextResponse.json({
        received: true,
        processed: true,
        eventId: event.id,
        paymentRecorded: processed.paymentRecorded,
        processingTimeMs,
      });
    }
    logger.error('[Stripe Payment Webhook] Event processing failed', {
      eventId, eventType, tenantId: dispatchTenantId, error: processed.error, processingTimeMs,
    });
    logDelivery({ route, tenantId: dispatchTenantId, secretSource, outcome: 'dispatch_failed', eventId, eventType }, 'error');
    // 200 so Stripe does not retry immediately; the failure is logged.
    return NextResponse.json({ received: true, processed: false, error: 'Processing failed (logged)' });
  } catch (error) {
    logger.error('[Stripe Payment Webhook] Unexpected error:', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      processingTimeMs: Date.now() - startTime,
    });
    logDelivery({ route, tenantId: tenantIdFromRoute ?? null, secretSource: null, outcome: 'error', eventId, eventType }, 'error');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** POST /api/webhooks/stripe/payments (legacy shared endpoint). */
export async function POST(req: NextRequest) {
  return handlePaymentsWebhookDelivery(req, 'legacy');
}

async function processStripePaymentWebhookPayload(tenantId: string, payload: string): Promise<WebhookProcessingResult> {
  if (process.env.EDITION !== 'ee' && process.env.NEXT_PUBLIC_EDITION !== 'enterprise') {
    return { success: false, error: 'Payment integration not available' } as WebhookProcessingResult;
  }

  try {
    const ee = await loadEnterprisePayments();
    if (!ee?.PaymentService || !ee?.createStripePaymentProvider) {
      return { success: false, error: 'Payment integration not available' } as WebhookProcessingResult;
    }

    const paymentService = await ee.PaymentService.create(tenantId);
    const provider = ee.createStripePaymentProvider(tenantId);
    const webhookEvent = provider.parseWebhookEvent(payload);

    return paymentService.processWebhookEvent(webhookEvent);
  } catch (error) {
    logger.error('[Stripe Payment Webhook] processStripePaymentWebhookPayload failed', { tenantId, error });
    return { success: false, error: 'Payment webhook processing failed' } as WebhookProcessingResult;
  }
}

// ── License-order webhook handling ───────────────────────────────────────────

function isLicenseOrderEvent(event: Stripe.Event): boolean {
  if (event.type !== 'checkout.session.completed') return false;
  const session = event.data.object as Stripe.Checkout.Session;
  return session.metadata?.is_license_order === 'true';
}

async function handleLicenseOrderWebhook(
  event: Stripe.Event
): Promise<{ success: boolean; error?: string }> {
  try {
    const session = event.data.object as Stripe.Checkout.Session;
    const metadata = session.metadata ?? {};

    const submissionId = metadata.service_request_submission_id;
    // Preserve orders created before Premium was retired without allowing the
    // legacy value into the active appliance-license model.
    const tier = metadata.tier === 'premium' ? 'pro' : metadata.tier;
    const seats = metadata.seats ? parseInt(metadata.seats, 10) : undefined;
    const transport = metadata.transport;
    const stripeSubId = (session.subscription as string) || session.id;
    const paymentIntentId = (session.payment_intent as string) || session.id;

    if (!submissionId || tier !== 'pro' || !transport) {
      logger.error('[License Order Webhook] Missing required metadata', { eventId: event.id, metadata });
      return { success: false, error: 'missing_metadata' };
    }

    const { getAdminConnection } = await import('@alga-psa/db/admin');
    const knex = await getAdminConnection();

    // Intentional admin lookup: tenant is derived from the submission.
    const submission = await tenantDb(knex, '__license_order_submission_discovery__')
      .unscoped(
        'service_request_submissions',
        'tenant discovery from license order submission webhook'
      )
      .where({ submission_id: submissionId })
      .first('submitted_payload', 'tenant', 'client_id');

    const tenant = submission?.tenant as string | undefined;
    const clientId = (submission?.client_id as string | undefined) ?? metadata.client_id;
    if (!tenant || !clientId) {
      logger.error('[License Order Webhook] Submission not found', { submissionId });
      return { success: false, error: 'submission_not_found' };
    }

    // Idempotency via payment_webhook_events (unique on tenant+provider+external id).
    // Temporal's workflow id (license-issue:{paymentIntentId}) is the exactly-once
    // backstop; this insert prevents redundant pre-workflow work.
    const inserted = await tenantDb(knex, tenant).table('payment_webhook_events')
      .insert({
        tenant,
        provider_type: 'stripe',
        external_event_id: event.id,
        event_type: event.type,
        event_data: JSON.stringify(event),
        processed: true,
        processing_status: 'completed',
        processed_at: knex.fn.now(),
      })
      .onConflict(['tenant', 'provider_type', 'external_event_id'])
      .ignore()
      .returning('event_id');

    if (!inserted || inserted.length === 0) {
      logger.info('[License Order Webhook] Already processed (idempotent)', { eventId: event.id });
      return { success: true };
    }

    // Client name → license customer (table is `clients`, PK client_id).
    const client = await tenantDb(knex, tenant).table('clients').where({ client_id: clientId }).first('client_name');
    const customer = (client?.client_name as string | undefined) ?? 'Unknown';

    // Start the issuance Temporal workflow (idempotent via workflow id)
    const { startApplianceLicenseIssuance } = await import('@enterprise/lib/workflows/applianceLicenseIssuanceTemporal');
    await startApplianceLicenseIssuance(paymentIntentId, {
      tenant,
      submissionId,
      clientId,
      customer,
      tier,
      seats,
      transport,
      stripeSubId,
    });

    logger.info('[License Order Webhook] Issuance workflow started', {
      eventId: event.id,
      workflowId: `license-issue:${paymentIntentId}`,
      submissionId,
    });

    return { success: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error('[License Order Webhook] Failed', { error: msg });
    return { success: false, error: msg };
  }
}

/**
 * GET /api/webhooks/stripe/payments
 *
 * Health check endpoint for Stripe payment webhook configuration
 */
export async function GET(req: NextRequest) {
  void req;
  const isEE = process.env.NEXT_PUBLIC_EDITION === 'enterprise';

  if (!isEE) {
    return NextResponse.json({
      status: 'unavailable',
      message: 'Stripe payment integration is only available in Enterprise Edition',
      edition: 'community',
    });
  }

  let webhookSecretStatus = 'missing';
  try {
    webhookSecretStatus = (await hasPlatformWebhookSecret()) ? 'configured' : 'missing';
  } catch {
    webhookSecretStatus = 'missing';
  }

  return NextResponse.json({
    status: 'ok',
    message: 'Stripe payment webhook endpoint is active',
    timestamp: new Date().toISOString(),
    webhookSecret: webhookSecretStatus,
    edition: 'enterprise',
    purpose: 'invoice_payments',
  });
}
