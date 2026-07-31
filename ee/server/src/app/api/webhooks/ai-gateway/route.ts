/**
 * AI Gateway Events Webhook Endpoint
 *
 * The AI gateway (services/ai-gateway) POSTs money/credit lifecycle events
 * here (low balance, grace, hard stop, auto-top-up outcomes) when
 * AI_GATEWAY_EVENTS_WEBHOOK_URL points at this route. Hosted-tenant events fan
 * out to tenant admins through the notification system; appliance events are
 * acknowledged but not handled here (appliances surface state via their own
 * account polling).
 * Auth: shared-secret header `X-Alga-Webhook-Secret`
 * (AI_GATEWAY_EVENTS_WEBHOOK_SECRET on both sides).
 */

import { Buffer } from 'node:buffer';
import { timingSafeEqual } from 'node:crypto';

import { NextResponse } from 'next/server';

import logger from '@alga-psa/core/logger';
import {
  AI_GATEWAY_EVENT_TYPES,
  notifyAiGatewayEvent,
  type AiGatewayEventType,
} from '../../../../lib/aiGateway/notifications';

export const runtime = 'nodejs';

const HEADER_NAME = 'x-alga-webhook-secret';

// LEVERAGE: pattern shared-secret-webhook-auth — third hand-rolled X-Alga-Webhook-Secret
// verification (see levelio route, ai-gateway requireAdmin); a shared helper is due.
function secretsEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function isGatewayEventType(value: unknown): value is AiGatewayEventType {
  return typeof value === 'string' && (AI_GATEWAY_EVENT_TYPES as readonly string[]).includes(value);
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204 });
}

export async function POST(req: Request) {
  try {
    const expectedSecret = process.env.AI_GATEWAY_EVENTS_WEBHOOK_SECRET?.trim();
    if (!expectedSecret) {
      return NextResponse.json(
        { error: 'AI gateway event webhook is not configured' },
        { status: 503 },
      );
    }

    const providedSecret = req.headers.get(HEADER_NAME) || '';
    if (!providedSecret || !secretsEqual(providedSecret, expectedSecret)) {
      return NextResponse.json({ error: 'Unauthorized: invalid webhook secret' }, { status: 401 });
    }

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const { type, tenantId, deploymentType, eventId } = body;
    if (!isGatewayEventType(type)) {
      return NextResponse.json({ error: 'Unknown gateway event type' }, { status: 400 });
    }
    if (typeof tenantId !== 'string' || !tenantId.trim()) {
      return NextResponse.json({ error: 'tenantId is required' }, { status: 400 });
    }

    if (deploymentType !== 'hosted') {
      // Appliance tenants learn about credit state through their own account
      // polling; acknowledge so the gateway does not treat this as a failure.
      return NextResponse.json({ ok: true, handled: false }, { status: 200 });
    }

    await notifyAiGatewayEvent(
      tenantId.trim(),
      type,
      typeof eventId === 'string' ? eventId : '',
    );
    return NextResponse.json({ ok: true, handled: true }, { status: 200 });
  } catch (err) {
    logger.error('[ai-gateway webhook] Failed to process gateway event', {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: 'Webhook could not be processed.' }, { status: 500 });
  }
}
