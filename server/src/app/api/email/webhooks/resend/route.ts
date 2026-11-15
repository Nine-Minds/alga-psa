import { NextResponse, type NextRequest } from 'next/server';
import logger from '@alga-psa/core/logger';
import { publishWorkflowEvent } from 'server/src/lib/eventBus/publishers';
import { reconcileOnWireMessageId } from '@alga-psa/email/reconcileOnWireMessageId';
import { getConnection } from '@alga-psa/db';
import {
  type ResendWorkflowEventToPublish,
  extractResendOnWireMessageIdUpdate,
  logResendWebhookMappingOutcome,
  mapResendWebhookToWorkflowEvents,
  verifyResendWebhookSignature,
} from 'server/src/services/email/webhooks/resendWebhookEvents';

export const runtime = 'nodejs';

// LEVERAGE: friction publish-event-union — a discriminated event union needs a per-variant switch
// because BuiltWorkflowPayload<A> | BuiltWorkflowPayload<B> is not assignable to BuiltWorkflowPayload<A | B>.
async function publishResendWorkflowEvent(event: ResendWorkflowEventToPublish): Promise<void> {
  const ctx = {
    tenantId: event.tenantId,
    correlationId: event.correlationId,
    actor: event.actor,
  };
  switch (event.eventType) {
    case 'EMAIL_DELIVERED':
      return publishWorkflowEvent({ eventType: event.eventType, payload: event.payload, ctx, idempotencyKey: event.idempotencyKey });
    case 'EMAIL_BOUNCED':
      return publishWorkflowEvent({ eventType: event.eventType, payload: event.payload, ctx, idempotencyKey: event.idempotencyKey });
    case 'EMAIL_COMPLAINT_RECEIVED':
      return publishWorkflowEvent({ eventType: event.eventType, payload: event.payload, ctx, idempotencyKey: event.idempotencyKey });
    case 'EMAIL_UNSUBSCRIBED':
      return publishWorkflowEvent({ eventType: event.eventType, payload: event.payload, ctx, idempotencyKey: event.idempotencyKey });
  }
}

export async function POST(request: NextRequest) {
  const payload = await request.text();

  const verified = verifyResendWebhookSignature({
    payload,
    headers: request.headers,
    webhookSecret: process.env.RESEND_WEBHOOK_SECRET,
  });

  if (!verified.verified) {
    logger.warn('[ResendWebhook] signature verification failed', { reason: verified.reason });
    return NextResponse.json({ ok: false, error: 'invalid_signature' }, { status: 401 });
  }

  let webhook: any;
  try {
    webhook = JSON.parse(payload);
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  // Record the on-wire Message-ID (every email.* event carries message_id, email.sent included).
  // Only reached after the signature verified, so the signed alga_tenant_id tag is trusted; the
  // operation matches on tenant + provider_message_id together. Failures never affect the response
  // or the workflow-event publishing below.
  const onWireUpdate = extractResendOnWireMessageIdUpdate(webhook);
  if (onWireUpdate) {
    try {
      const knex = await getConnection(onWireUpdate.tenantId);
      const outcome = await reconcileOnWireMessageId(knex, {
        tenant: onWireUpdate.tenantId,
        providerMessageId: onWireUpdate.providerMessageId,
        onWireMessageId: onWireUpdate.onWireMessageId,
      });
      logger.debug('[ResendWebhook] on-wire Message-ID reconciliation', {
        type: webhook?.type,
        tenantId: onWireUpdate.tenantId,
        status: outcome.status,
      });
    } catch (error) {
      logger.warn('[ResendWebhook] failed to reconcile on-wire Message-ID', {
        type: webhook?.type,
        tenantId: onWireUpdate.tenantId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const svixId = request.headers.get('svix-id');
  const events = mapResendWebhookToWorkflowEvents({ webhook, svixId });
  logResendWebhookMappingOutcome({ webhookType: webhook?.type, events });

  for (const event of events) {
    try {
      await publishResendWorkflowEvent(event);
    } catch (error) {
      logger.warn('[ResendWebhook] failed to publish workflow event', {
        eventType: event.eventType,
        tenantId: event.tenantId,
        error,
      });
    }
  }

  return NextResponse.json({ ok: true });
}

