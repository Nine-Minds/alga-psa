import { NextResponse, type NextRequest } from 'next/server';
import logger from '@alga-psa/core/logger';
import { publishWorkflowEvent } from 'server/src/lib/eventBus/publishers';
import {
  logResendWebhookMappingOutcome,
  mapResendWebhookToWorkflowEvents,
  verifyResendWebhookSignature,
} from 'server/src/services/email/webhooks/resendWebhookEvents';

export const runtime = 'nodejs';

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

  const svixId = request.headers.get('svix-id');
  const events = mapResendWebhookToWorkflowEvents({ webhook, svixId });
  logResendWebhookMappingOutcome({ webhookType: webhook?.type, events });

  for (const event of events) {
    try {
      await publishWorkflowEvent({
        eventType: event.eventType,
        payload: event.payload,
        ctx: {
          tenantId: event.tenantId,
          correlationId: event.correlationId,
          actor: event.actor,
        },
        idempotencyKey: event.idempotencyKey,
      });
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

