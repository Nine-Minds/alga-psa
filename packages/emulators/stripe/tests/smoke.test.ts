import http from 'node:http';
import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EmulatorHost } from '@alga-psa/emulator-host';
import stripeEmulator from '../src/index';

let host: EmulatorHost;
let base: string;
let control: string;
let webhook: http.Server;
let webhookPort: number;
const received: Array<{ payload: string; signature: string }> = [];

const SECRET_KEY = 'sk_test_algasim';
const WEBHOOK_SECRET = 'whsec_algasim';

function verifyStripeSignature(payload: string, signature: string, secret: string): boolean {
  const header = new Map(
    signature.split(',').map((part) => {
      const idx = part.indexOf('=');
      return [part.slice(0, idx), part.slice(idx + 1)];
    }),
  );
  const timestamp = header.get('t');
  const expected = header.get('v1');
  if (!timestamp || !expected) return false;
  const digest = createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');
  return expected === digest;
}

async function controlPost(path: string, body?: unknown): Promise<any> {
  const response = await fetch(`${control}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  return response.json();
}

function form(entries: Record<string, unknown>, extraHeaders: Record<string, string> = {}): RequestInit {
  const params = new URLSearchParams();
  const flatten = (prefix: string, value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => flatten(`${prefix}[${index}]`, item));
    } else if (value !== null && typeof value === 'object') {
      for (const [key, nested] of Object.entries(value)) {
        flatten(`${prefix}[${key}]`, nested);
      }
    } else {
      params.append(prefix, String(value));
    }
  };
  for (const [key, value] of Object.entries(entries)) {
    flatten(key, value);
  }
  return {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...extraHeaders },
    body: params.toString(),
  };
}

const auth = { authorization: `Bearer ${SECRET_KEY}` };

beforeAll(async () => {
  webhook = http
    .createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      received.push({
        payload: Buffer.concat(chunks).toString('utf8'),
        signature: String(req.headers['stripe-signature'] ?? ''),
      });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ received: true }));
    })
    .listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => webhook.once('listening', resolve));
  webhookPort = (webhook.address() as { port: number }).port;

  host = new EmulatorHost({ emulators: [stripeEmulator], controlPort: 0, ports: { stripe: 0 } });
  const { controlPort, ports } = await host.start();
  base = `http://127.0.0.1:${ports.stripe}`;
  control = `http://127.0.0.1:${controlPort}`;

  await controlPost('/control/stripe/seed/config', {
    secretKey: SECRET_KEY,
    webhookSecret: WEBHOOK_SECRET,
    webhookTarget: `http://127.0.0.1:${webhookPort}/webhook`,
  });
});

afterAll(async () => {
  await host.stop();
  await new Promise((resolve) => webhook.close(resolve));
});

describe('stripe emulator wire contract', { shuffle: false }, () => {
  it('rejects unauthenticated requests with a Stripe-shaped 401', async () => {
    const response = await fetch(`${base}/v1/customers`);
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.type).toBe('authentication_error');
  });

  it('creates, lists, and retrieves customers; unknown customer is a Stripe 404', async () => {
    const createdResponse = await fetch(
      `${base}/v1/customers`,
      form({ email: 'billing@acme.example', name: 'Acme Corporation', 'metadata[tenant_id]': 'tenant-1' }, auth),
    );
    expect(createdResponse.status).toBe(200);
    const customer = await createdResponse.json();
    expect(customer.id).toMatch(/^cus_/);
    expect(customer.email).toBe('billing@acme.example');

    const list = await (await fetch(`${base}/v1/customers?email=billing%40acme.example`, { headers: auth })).json();
    expect(list.object).toBe('list');
    expect(list.data).toHaveLength(1);
    expect(list.data[0].id).toBe(customer.id);

    const empty = await (await fetch(`${base}/v1/customers?email=nobody%40x.example`, { headers: auth })).json();
    expect(empty.data).toHaveLength(0);

    const retrieved = await (await fetch(`${base}/v1/customers/${customer.id}`, { headers: auth })).json();
    expect(retrieved.id).toBe(customer.id);

    const missing = await fetch(`${base}/v1/customers/cus_nope`, { headers: auth });
    expect(missing.status).toBe(404);
    expect((await missing.json()).error.message).toContain('No such customer');
  });

  it('creates a Checkout session from nested form encoding and supports expand[]', async () => {
    const createdResponse = await fetch(
      `${base}/v1/checkout/sessions`,
      form({
        mode: 'payment',
        customer: 'cus_1',
        'line_items[0][price_data][currency]': 'usd',
        'line_items[0][price_data][unit_amount]': '25000',
        'line_items[0][price_data][product_data][name]': 'Invoice INV-001',
        'line_items[0][quantity]': '1',
        success_url: 'http://localhost:3000/client-portal/billing/invoices/inv-1/payment-success?session_id={CHECKOUT_SESSION_ID}',
        cancel_url: 'http://localhost:3000/client-portal/billing?tab=invoices&invoiceId=inv-1',
        'metadata[invoice_id]': 'inv-1',
        'metadata[tenant_id]': 'tenant-1',
      }, auth),
    );
    expect(createdResponse.status).toBe(200);
    const session = await createdResponse.json();
    expect(session.id).toMatch(/^cs_/);
    expect(session.amount_total).toBe(25000);
    expect(session.currency).toBe('usd');
    expect(session.metadata.invoice_id).toBe('inv-1');
    expect(session.payment_intent).toMatch(/^pi_/);
    expect(session.url).toContain('/checkout/sessions/');
    expect(session.url).toContain(session.id);

    const expanded = await (
      await fetch(`${base}/v1/checkout/sessions/${session.id}?expand[]=payment_intent`, { headers: auth })
    ).json();
    expect(expanded.payment_intent.id).toBe(session.payment_intent);

    const collapsed = await (
      await fetch(`${base}/v1/checkout/sessions/${session.id}`, { headers: auth })
    ).json();
    expect(collapsed.payment_intent).toBe(session.payment_intent);
  });

  it('hosted Pay completes the session, delivers a signed webhook, and 303s to success_url', async () => {
    const session = await (
      await fetch(
        `${base}/v1/checkout/sessions`,
        form({
          mode: 'payment',
          'line_items[0][price_data][currency]': 'eur',
          'line_items[0][price_data][unit_amount]': '10000',
          'line_items[0][quantity]': '1',
          success_url: 'http://localhost:3000/client-portal/billing/invoices/inv-pay/payment-success?session_id={CHECKOUT_SESSION_ID}',
          cancel_url: 'http://localhost:3000/client-portal/billing',
          'metadata[invoice_id]': 'inv-pay',
        }, auth),
      )
    ).json();

    const before = received.length;
    const page = await fetch(`${base}${session.url.replace(base, '')}`);
    expect(page.headers.get('content-type')).toContain('text/html');

    const pay = await fetch(`${base}/checkout/sessions/${session.id}/pay`, { method: 'POST', redirect: 'manual' });
    expect(pay.status).toBe(303);
    expect(pay.headers.get('location')).toBe(
      'http://localhost:3000/client-portal/billing/invoices/inv-pay/payment-success?session_id=' + session.id,
    );

    expect(received.length).toBe(before + 1);
    const delivery = received[before];
    const event = JSON.parse(delivery.payload);
    expect(event.type).toBe('checkout.session.completed');
    expect(event.data.object.id).toBe(session.id);
    expect(event.data.object.payment_status).toBe('paid');
    expect(verifyStripeSignature(delivery.payload, delivery.signature, WEBHOOK_SECRET)).toBe(true);

    const state = await (await fetch(`${control}/control/stripe/state/webhook-deliveries`)).json();
    expect(state.result).toHaveLength(1);
    expect(state.result[0].status).toBe(200);
    expect(state.result[0].eventId).toBe(event.id);

    const completed = await (await fetch(`${base}/v1/checkout/sessions/${session.id}`, { headers: auth })).json();
    expect(completed.status).toBe('complete');
  });

  it('hosted Decline records a failed attempt and emits payment_intent.payment_failed', async () => {
    const session = await (
      await fetch(
        `${base}/v1/checkout/sessions`,
        form({
          mode: 'payment',
          'line_items[0][price_data][currency]': 'usd',
          'line_items[0][price_data][unit_amount]': '5000',
          'line_items[0][quantity]': '1',
          success_url: 'http://localhost:3000/success',
          cancel_url: 'http://localhost:3000/billing',
          'metadata[invoice_id]': 'inv-decline',
        }, auth),
      )
    ).json();

    const before = received.length;
    const decline = await fetch(`${base}/checkout/sessions/${session.id}/decline`, { method: 'POST' });
    expect(decline.status).toBe(200);
    expect(await decline.text()).toContain('declined');

    const event = JSON.parse(received[before].payload);
    expect(event.type).toBe('payment_intent.payment_failed');
    expect(verifyStripeSignature(received[before].payload, received[before].signature, WEBHOOK_SECRET)).toBe(true);

    const intent = await (await fetch(`${base}/v1/checkout/sessions/${session.id}?expand[]=payment_intent`, { headers: auth })).json();
    expect(intent.payment_intent.last_payment_error.code).toBe('card_declined');

    // A declined attempt stays retryable.
    const retry = await fetch(`${base}/checkout/sessions/${session.id}/pay`, { method: 'POST', redirect: 'manual' });
    expect(retry.status).toBe(303);
    expect(retry.headers.get('location')).toBe('http://localhost:3000/success');
  });

  it('hosted Cancel 303s to cancel_url without marking the session paid', async () => {
    const session = await (
      await fetch(
        `${base}/v1/checkout/sessions`,
        form({
          mode: 'payment',
          'line_items[0][price_data][currency]': 'usd',
          'line_items[0][price_data][unit_amount]': '3000',
          'line_items[0][quantity]': '1',
          success_url: 'http://localhost:3000/success',
          cancel_url: 'http://localhost:3000/billing?tab=invoices&invoiceId=inv-cancel',
          'metadata[invoice_id]': 'inv-cancel',
        }, auth),
      )
    ).json();

    const eventsBefore = received.length;
    const cancel = await fetch(`${base}/checkout/sessions/${session.id}/cancel`, { method: 'POST', redirect: 'manual' });
    expect(cancel.status).toBe(303);
    expect(cancel.headers.get('location')).toBe('http://localhost:3000/billing?tab=invoices&invoiceId=inv-cancel');

    const state = await (await fetch(`${control}/control/stripe/state/checkout-sessions`)).json();
    const stored = state.result.find((s: any) => s.id === session.id);
    expect(stored.payment_status).toBe('unpaid');
    expect(received.length).toBe(eventsBefore);
  });

  it('expires an open Checkout session through the Stripe API surface', async () => {
    const session = await (
      await fetch(
        `${base}/v1/checkout/sessions`,
        form({
          mode: 'payment',
          'line_items[0][price_data][currency]': 'usd',
          'line_items[0][price_data][unit_amount]': '4200',
          'line_items[0][quantity]': '1',
          success_url: 'http://localhost:3000/success',
          cancel_url: 'http://localhost:3000/billing',
          'metadata[invoice_id]': 'inv-expire',
        }, auth),
      )
    ).json();

    const response = await fetch(`${base}/v1/checkout/sessions/${session.id}/expire`, {
      method: 'POST',
      headers: auth,
    });
    expect(response.status).toBe(200);
    expect((await response.json()).status).toBe('expired');

    const stored = await (
      await fetch(`${base}/v1/checkout/sessions/${session.id}`, { headers: auth })
    ).json();
    expect(stored.status).toBe('expired');
  });

  it('injects Stripe-shaped operation faults that expire after N uses', async () => {
    await controlPost('/control/stripe/faults/operation-fault/arm', {
      operation: 'checkout.sessions.create',
      status: 500,
      code: 'api_error',
      message: 'Simulated Stripe outage',
      remaining: 1,
    });

    const failed = await fetch(
      `${base}/v1/checkout/sessions`,
      form({
        mode: 'payment',
        'line_items[0][price_data][currency]': 'usd',
        'line_items[0][price_data][unit_amount]': '1000',
        'line_items[0][quantity]': '1',
        success_url: 'http://localhost:3000/success',
      }, auth),
    );
    expect(failed.status).toBe(500);
    expect((await failed.json()).error.message).toBe('Simulated Stripe outage');

    const ok = await fetch(
      `${base}/v1/checkout/sessions`,
      form({
        mode: 'payment',
        'line_items[0][price_data][currency]': 'usd',
        'line_items[0][price_data][unit_amount]': '1000',
        'line_items[0][quantity]': '1',
        success_url: 'http://localhost:3000/success',
      }, auth),
    );
    expect(ok.status).toBe(200);
  });

  it('surfaces a fault-armed custom code in the Stripe error envelope', async () => {
    await controlPost('/control/stripe/faults/operation-fault/arm', {
      operation: 'checkout.sessions.create',
      status: 402,
      code: 'card_declined',
      message: 'Your card was declined.',
      remaining: 1,
    });

    const failed = await fetch(
      `${base}/v1/checkout/sessions`,
      form({
        mode: 'payment',
        'line_items[0][price_data][currency]': 'usd',
        'line_items[0][price_data][unit_amount]': '1000',
        'line_items[0][quantity]': '1',
        success_url: 'http://localhost:3000/success',
      }, auth),
    );
    expect(failed.status).toBe(402);
    const body = await failed.json();
    expect(body.error.type).toBe('api_error');
    expect(body.error.code).toBe('card_declined');
    expect(body.error.message).toBe('Your card was declined.');
  });

  it('supports the complete-session control action for non-browser tests', async () => {
    const session = await (
      await fetch(
        `${base}/v1/checkout/sessions`,
        form({
          mode: 'payment',
          'line_items[0][price_data][currency]': 'usd',
          'line_items[0][price_data][unit_amount]': '4200',
          'line_items[0][quantity]': '1',
          success_url: 'http://localhost:3000/success',
          cancel_url: 'http://localhost:3000/billing',
          'metadata[invoice_id]': 'inv-action',
        }, auth),
      )
    ).json();

    const before = received.length;
    const completed = await controlPost('/control/stripe/actions/complete-session', { sessionId: session.id });
    expect(completed.ok).toBe(true);
    expect(completed.result.eventType).toBe('checkout.session.completed');

    const event = JSON.parse(received[before].payload);
    expect(event.data.object.id).toBe(session.id);
  });

  it('reset restores deterministic empty state', async () => {
    await controlPost('/control/stripe/reset');
    const customers = await (await fetch(`${control}/control/stripe/state/customers`)).json();
    const sessions = await (await fetch(`${control}/control/stripe/state/checkout-sessions`)).json();
    expect(customers.result).toHaveLength(0);
    expect(sessions.result).toHaveLength(0);
    // Credentials revert to the defaults after reset; the control plane never
    // round-trips raw `sk_*`/`whsec_*` values, and the public publishable key
    // stays visible.
    const config = await (await fetch(`${control}/control/stripe/state/config`)).json();
    expect(config.result.publishableKey).toBe('pk_test_algasim');
    expect(config.result.secretKey).not.toContain('sk_test_algasim');
    expect(config.result.webhookSecret).not.toContain('whsec_algasim');
    // The emulator still authenticates with the fixture despite the redaction.
    const authed = await fetch(`${base}/v1/customers`, { headers: auth });
    expect(authed.status).toBe(200);
  });
});
