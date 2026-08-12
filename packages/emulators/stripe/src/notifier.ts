import { createHmac } from 'node:crypto';
import type { HostEnv } from '@alga-psa/emulator-host';
import type { StripeEmulatorCore, StripeEvent } from './core';

/**
 * Stripe-style webhook signature over `timestamp.payload` with the configured
 * `whsec_*` secret, matching what `Stripe.webhooks.constructEvent` validates.
 */
export function signStripePayload(payload: string, secret: string, timestamp?: number): string {
  const ts = timestamp ?? Math.floor(Date.now() / 1000);
  const signature = createHmac('sha256', secret).update(`${ts}.${payload}`).digest('hex');
  return `t=${ts},v1=${signature}`;
}

/**
 * Delivers a signed event to every configured webhook target and records the
 * delivery outcome in the pure core. I/O stays here, outside the core.
 */
export async function deliverEvent(core: StripeEmulatorCore, event: StripeEvent, env: HostEnv): Promise<void> {
  const payload = JSON.stringify(event);
  for (const target of core.webhookTargets) {
    const signature = signStripePayload(payload, core.webhookSecret, event.created);
    let status = 0;
    let response = '';
    try {
      const res = await fetch(target, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'stripe-signature': signature,
        },
        body: payload,
      });
      status = res.status;
      response = (await res.text()).slice(0, 500);
    } catch (error) {
      status = 0;
      response = error instanceof Error ? error.message : String(error);
    }
    core.recordDelivery({
      eventId: event.id,
      eventType: event.type,
      target,
      attempt: 1,
      status,
      response,
    });
    env.log('stripe webhook delivery', { eventId: event.id, eventType: event.type, target, status });
  }
}
