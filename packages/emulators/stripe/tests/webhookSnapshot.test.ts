import http from 'node:http';
import { once } from 'node:events';
import Stripe from 'stripe';
import { expect, it } from 'vitest';
import { EmulatorHost, VirtualClock, seededRng } from '@alga-psa/emulator-host';
import stripeEmulator from '../src/index';
import { StripeEmulatorCore } from '../src/core';

// Stripe v1 event data is an immutable resource snapshot, including on replay:
// https://docs.stripe.com/api/events/object (reviewed 2026-09-08).
it('preserves nested event data after the underlying resource changes', () => {
  const core = new StripeEmulatorCore({ clock: new VirtualClock(), rng: seededRng(1), log: () => {} });
  const session = core.createCheckoutSession({
    mode: 'payment', line_items: [{ price_data: { unit_amount: 1200 }, quantity: 1 }],
    success_url: 'https://example.test/success', metadata: { invoice_id: 'inv-original' },
  }, 'http://localhost');
  const event = core.completeSession(session.id);
  session.metadata.invoice_id = 'inv-changed';
  session.line_items[0].price.unit_amount = 9999;
  expect(event.data.object.metadata).toEqual({ invoice_id: 'inv-original' });
  expect(event.data.object.line_items).toEqual([
    { price: { currency: 'usd', unit_amount: 1200, product: { name: 'Invoice payment' } }, quantity: 1 },
  ]);
});

it('replays the original signed failure snapshot after payment recovery and a failed delivery', async () => {
  const received: Array<{ payload: string; signature: string }> = [];
  const receiver = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    received.push({ payload: Buffer.concat(chunks).toString(), signature: String(req.headers['stripe-signature']) });
    res.writeHead(received.length === 1 ? 503 : 200);
    res.end();
  });
  const host = new EmulatorHost({ emulators: [stripeEmulator], controlPort: 0, ports: { stripe: 0 } });
  try {
    receiver.listen(0, '127.0.0.1');
    await once(receiver, 'listening');
    const { controlPort, ports } = await host.start();
    const control = `http://127.0.0.1:${controlPort}`;
    const post = async (path: string, input: unknown) => {
      const response = await fetch(`${control}/control/stripe/${path}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
      });
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.ok).toBe(true);
      return body.result;
    };
    await post('seed/config', { webhookTarget: `http://127.0.0.1:${(receiver.address() as { port: number }).port}/hook` });
    const sdk = new Stripe('sk_test_algasim', { host: '127.0.0.1', port: ports.stripe, protocol: 'http' });
    const session = await sdk.checkout.sessions.create({
      mode: 'payment', success_url: 'https://example.test/success',
      line_items: [{ price_data: { currency: 'usd', unit_amount: 1200, product_data: { name: 'Invoice' } }, quantity: 1 }],
    });
    const failed = await post('actions/fail-session', { sessionId: session.id });
    const original = sdk.webhooks.constructEvent(received[0].payload, received[0].signature, 'whsec_algasim');
    expect(original.type).toBe('payment_intent.payment_failed');
    expect((original.data.object as Stripe.PaymentIntent).status).toBe('requires_payment_method');
    await post('actions/complete-session', { sessionId: session.id });
    expect((await sdk.checkout.sessions.retrieve(session.id)).payment_status).toBe('paid');
    await post('actions/redeliver-event', { eventId: failed.eventId });
    expect(received).toHaveLength(3);
    const replay = sdk.webhooks.constructEvent(received[2].payload, received[2].signature, 'whsec_algasim');
    expect(replay).toEqual(original);
    expect(received[2].payload).toBe(received[0].payload);
    const deliveries = await (await fetch(`${control}/control/stripe/state/webhook-deliveries`)).json();
    expect(deliveries.result.filter((item: { eventId: string }) => item.eventId === failed.eventId)
      .map((item: { attempt: number; status: number }) => ({ attempt: item.attempt, status: item.status })))
      .toEqual([{ attempt: 1, status: 503 }, { attempt: 2, status: 200 }]);
  } finally {
    await host.stop();
    await new Promise<void>((resolve, reject) => receiver.close(error => error ? reject(error) : resolve()));
  }
});
