import http from 'node:http';
import Stripe from 'stripe';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { EmulatorHost } from '@alga-psa/emulator-host';
import stripeEmulator from '../src/index';

// Drives /v1/webhook_endpoints through the real Stripe SDK (as the app does)
// and checks that deliveries follow each endpoint's current URL and secret.

const SECRET_KEY = 'sk_test_algasim';
let host: EmulatorHost;
let control: string;
let stripe: Stripe;
let sink: http.Server;
let sinkBase: string;
const received: Array<{ path: string; payload: string; signature: string }> = [];

async function controlPost(path: string, body?: unknown): Promise<any> {
  const response = await fetch(`${control}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  return response.json();
}

async function controlGet(path: string): Promise<any> {
  return (await fetch(`${control}${path}`)).json();
}

async function payNewSession(metadata: Record<string, string> = {}): Promise<void> {
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    success_url: 'http://localhost/done',
    line_items: [{ price_data: { currency: 'usd', unit_amount: 500, product_data: { name: 'x' } }, quantity: 1 }],
    metadata,
  });
  await controlPost('/control/stripe/actions/complete-session', { sessionId: session.id });
}

beforeAll(async () => {
  sink = http
    .createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      received.push({
        path: req.url ?? '',
        payload: Buffer.concat(chunks).toString('utf8'),
        signature: String(req.headers['stripe-signature'] ?? ''),
      });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
    })
    .listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => sink.once('listening', resolve));
  sinkBase = `http://127.0.0.1:${(sink.address() as { port: number }).port}`;

  host = new EmulatorHost({ emulators: [stripeEmulator], controlPort: 0, ports: { stripe: 0 } });
  const { controlPort, ports } = await host.start();
  control = `http://127.0.0.1:${controlPort}`;
  stripe = new Stripe(SECRET_KEY, { host: '127.0.0.1', port: ports.stripe, protocol: 'http' });
});

afterAll(async () => {
  await host?.stop();
  await new Promise<void>((resolve) => sink.close(() => resolve()));
});

beforeEach(async () => {
  received.length = 0;
  await controlPost('/control/stripe/reset');
});

describe('stripe emulator webhook endpoints', () => {
  it('creates, retrieves, lists, updates and deletes with Stripe semantics', async () => {
    const created = await stripe.webhookEndpoints.create({
      url: `${sinkBase}/hook`,
      enabled_events: ['checkout.session.completed', 'charge.refunded'],
    });
    expect(created.id).toMatch(/^we_/);
    expect(created.secret).toMatch(/^whsec_/);
    expect(created.enabled_events).toEqual(['checkout.session.completed', 'charge.refunded']);

    const retrieved = await stripe.webhookEndpoints.retrieve(created.id);
    expect(retrieved.url).toBe(`${sinkBase}/hook`);
    expect(retrieved.secret).toBeUndefined();
    expect((await stripe.webhookEndpoints.list()).data.map((e) => e.id)).toEqual([created.id]);

    // URL-only update keeps the subscription.
    const moved = await stripe.webhookEndpoints.update(created.id, { url: `${sinkBase}/hook/t1` });
    expect(moved.url).toBe(`${sinkBase}/hook/t1`);
    expect(moved.enabled_events).toEqual(['checkout.session.completed', 'charge.refunded']);

    const deleted = await stripe.webhookEndpoints.del(created.id);
    expect(deleted.deleted).toBe(true);
    await expect(stripe.webhookEndpoints.retrieve(created.id)).rejects.toMatchObject({
      statusCode: 404,
      code: 'resource_missing',
    });
  });

  it('delivers to the endpoint URL signed with its secret, and follows a URL update', async () => {
    const secret = 'whsec_test_endpoint_secret';
    await controlPost('/control/stripe/seed/webhook-endpoint', {
      id: 'we_fixture',
      url: `${sinkBase}/legacy`,
      enabledEvents: ['checkout.session.completed'],
      secret,
    });

    await payNewSession();
    expect(received.map((r) => r.path)).toEqual(['/legacy']);
    expect(() => stripe.webhooks.constructEvent(received[0].payload, received[0].signature, secret)).not.toThrow();

    await stripe.webhookEndpoints.update('we_fixture', { url: `${sinkBase}/legacy/t1` });
    await payNewSession();
    expect(received.map((r) => r.path)).toEqual(['/legacy', '/legacy/t1']);
    expect(() => stripe.webhooks.constructEvent(received[1].payload, received[1].signature, secret)).not.toThrow();

    const deliveries = (await controlGet('/control/stripe/state/webhook-deliveries')).result;
    expect(deliveries.map((d: any) => d.endpointId)).toEqual(['we_fixture', 'we_fixture']);
    const view = (await controlGet('/control/stripe/state/webhook-endpoints')).result;
    expect(view[0]).toMatchObject({ id: 'we_fixture', url: `${sinkBase}/legacy/t1` });
    expect(JSON.stringify(view)).not.toContain(secret);
  });

  it('skips disabled endpoints and endpoints not subscribed to the event type', async () => {
    await controlPost('/control/stripe/seed/webhook-endpoint', {
      id: 'we_other', url: `${sinkBase}/other`, enabledEvents: ['charge.refunded'],
    });
    await controlPost('/control/stripe/seed/webhook-endpoint', {
      id: 'we_off', url: `${sinkBase}/off`, enabledEvents: ['*'],
    });
    await stripe.webhookEndpoints.update('we_off', { disabled: true });
    await payNewSession();
    expect(received).toEqual([]);
  });

  it('honours armed webhook_endpoints faults', async () => {
    await controlPost('/control/stripe/seed/webhook-endpoint', { id: 'we_fault', url: `${sinkBase}/x` });
    await controlPost('/control/stripe/faults/operation-fault/arm', {
      // remaining > 1: the SDK retries a 500 once by default.
      operation: 'webhook_endpoints.update', status: 500, message: 'boom', remaining: 5,
    });
    await expect(stripe.webhookEndpoints.update('we_fault', { url: `${sinkBase}/y` })).rejects.toMatchObject({
      statusCode: 500,
    });
    expect((await stripe.webhookEndpoints.retrieve('we_fault')).url).toBe(`${sinkBase}/x`);
    await controlPost('/control/stripe/faults/operation-fault/disarm');
    expect((await stripe.webhookEndpoints.update('we_fault', { url: `${sinkBase}/y` })).url).toBe(`${sinkBase}/y`);
  });
});
