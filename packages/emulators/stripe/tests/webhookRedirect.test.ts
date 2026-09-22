import http from 'node:http';
import { once } from 'node:events';
import Stripe from 'stripe';
import { expect, it } from 'vitest';
import { VirtualClock, seededRng } from '@alga-psa/emulator-host';
import { StripeEmulatorCore } from '../src/core';
import { deliverEvent } from '../src/notifier';

// Stripe treats webhook redirects as failed deliveries, including 302 and 307.
// https://docs.stripe.com/webhooks#fix-http-status-codes (reviewed 2026-09-08).
it.each([302, 307])('records %s without following its Location and continues other deliveries', async status => {
  const requests: Array<{ path: string; method: string; body: string; signature: string }> = [];
  const receiver = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    requests.push({ path: req.url!, method: req.method!, body: Buffer.concat(chunks).toString(),
      signature: String(req.headers['stripe-signature'] ?? '') });
    if (req.url === '/redirect') res.writeHead(status, { location: '/redirect-destination' });
    else res.writeHead(200);
    res.end();
  });
  try {
    receiver.listen(0, '127.0.0.1');
    await once(receiver, 'listening');
    const base = `http://127.0.0.1:${(receiver.address() as { port: number }).port}`;
    const env = { clock: new VirtualClock(), rng: seededRng(1), log: () => {} };
    const core = new StripeEmulatorCore(env);
    core.configure({ webhookTargets: [`${base}/redirect`, `${base}/healthy`] });
    const session = core.createCheckoutSession({ mode: 'payment', line_items: [],
      success_url: 'https://example.test/success', metadata: {} }, base);
    const event = core.completeSession(session.id);
    await deliverEvent(core, event, env);

    expect(requests.map(request => request.path)).toEqual(['/redirect', '/healthy']);
    expect(core.deliveries.map(delivery => ({ target: delivery.target, status: delivery.status, attempt: delivery.attempt })))
      .toEqual([{ target: `${base}/redirect`, status, attempt: 1 }, { target: `${base}/healthy`, status: 200, attempt: 1 }]);
    const sdk = new Stripe('sk_test_algasim');
    for (const request of requests) {
      expect(request.method).toBe('POST');
      expect(sdk.webhooks.constructEvent(request.body, request.signature, core.webhookSecret)).toEqual(event);
    }
  } finally {
    await new Promise<void>((resolve, reject) => receiver.close(error => error ? reject(error) : resolve()));
  }
});
