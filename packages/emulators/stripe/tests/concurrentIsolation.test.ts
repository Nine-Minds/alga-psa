import http from 'node:http';
import { once } from 'node:events';
import Stripe from 'stripe';
import { expect, it } from 'vitest';
import { EmulatorHost } from '@alga-psa/emulator-host';
import stripe from '../src/index';

// Composes with production browser journeys: this exercises isolated emulator
// fixtures and signed HTTP callbacks, not an Alga application or browser mock.
it('resetting one scenario leaves another in-flight callback, state, credentials and faults isolated', async () => {
  let release!: () => void;
  let arrived!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const receiving = new Promise<void>(resolve => { arrived = resolve; });
  const captures: Array<Array<{ body: string; signature: string }>> = [[], []];
  const receivers = captures.map((received, index) => http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    received.push({ body: Buffer.concat(chunks).toString(), signature: String(req.headers['stripe-signature']) });
    if (index === 1 && received.length === 1) { arrived(); await held; }
    res.end('ok');
  }));
  const hosts = [0, 1].map(() => new EmulatorHost({ emulators: [stripe], seed: 17,
    controlPort: 0, ports: { stripe: 0 }, log() {} }));
  let pending: Promise<unknown> | undefined;
  try {
    for (const receiver of receivers) { receiver.listen(0, '127.0.0.1'); await once(receiver, 'listening'); }
    const addresses = await Promise.all(hosts.map(host => host.start()));
    const bases = addresses.map(value => `http://127.0.0.1:${value.ports.stripe}`);
    const targets = receivers.map(server => `http://127.0.0.1:${(server.address() as { port: number }).port}/callback`);
    const control = async (index: number, path: string, body?: unknown) => {
      const response = await fetch(`http://127.0.0.1:${addresses[index].controlPort}/control/stripe/${path}`, {
        ...(body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(5000),
      });
      expect(response.status).toBe(200);
      return (await response.json()).result;
    };
    const vendor = (index: number, key = `sk_test_scenario_${index}`) => fetch(`${bases[index]}/v1/customers`, {
      headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(5000),
    });
    const customers = [], sessions = [];
    for (const index of [0, 1]) {
      await control(index, 'seed/config', { secretKey: `sk_test_scenario_${index}`,
        webhookSecret: `whsec_scenario_${index}`, webhookTarget: targets[index] });
      customers.push(await control(index, 'seed/customer', { email: `scenario-${index}@example.invalid` }));
      const response = await fetch(`${bases[index]}/v1/checkout/sessions`, { method: 'POST',
        headers: { authorization: `Bearer sk_test_scenario_${index}`, 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ mode: 'payment', success_url: 'https://example.invalid/success',
          'line_items[0][price_data][currency]': 'usd', 'line_items[0][price_data][unit_amount]': String(100 + index),
          'line_items[0][quantity]': '1', 'metadata[scenario]': String(index) }), signal: AbortSignal.timeout(5000) });
      expect(response.status).toBe(200); sessions.push(await response.json());
      expect((await (await vendor(index)).json()).data).toEqual([customers[index]]);
      await control(index, 'faults/operation-fault/arm', { operation: 'customers.list', status: 429, remaining: 1 });
    }
    expect(customers[0].id).toBe(customers[1].id);
    expect(sessions[0].id).toBe(sessions[1].id);
    const beforeB = await control(1, 'state/config');
    const faultsB = await control(1, 'state/operation-faults');
    pending = control(1, 'actions/complete-session', { sessionId: sessions[1].id });
    // Attach rejection immediately while awaiting the receiver barrier.
    void pending.catch(() => {});
    let barrierTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([receiving, new Promise((_, reject) => {
        barrierTimer = setTimeout(() => reject(new Error('Callback did not arrive')), 4000);
      })]);
    } finally { clearTimeout(barrierTimer); }
    await control(0, 'actions/complete-session', { sessionId: sessions[0].id });
    await control(0, 'reset', {});
    expect(await control(0, 'state/customers')).toEqual([]);
    expect(await control(0, 'state/events')).toEqual([]);
    expect(await control(0, 'state/operation-faults')).toEqual([]);
    expect(await control(1, 'state/customers')).toEqual([customers[1]]);
    expect(await control(1, 'state/config')).toEqual(beforeB);
    expect(await control(1, 'state/operation-faults')).toEqual(faultsB);
    expect(await control(1, 'state/webhook-deliveries')).toEqual([]);
    expect((await vendor(0)).status).toBe(401);
    expect((await vendor(0, 'sk_test_algasim')).status).toBe(200);
    release(); await pending;
    expect((await vendor(1, 'sk_test_scenario_0')).status).toBe(401);
    expect((await vendor(1)).status).toBe(429);
    expect((await (await vendor(1)).json()).data).toEqual([customers[1]]);
    const events = await control(1, 'state/events');
    await control(1, 'actions/redeliver-event', { eventId: events[0].id });
    expect(captures.map(items => items.length)).toEqual([1, 2]);
    const sdk = new Stripe('sk_test_verification');
    for (const index of [0, 1]) for (const capture of captures[index]) {
      const event = sdk.webhooks.constructEvent(capture.body, capture.signature, `whsec_scenario_${index}`);
      expect(event.data.object).toMatchObject({ metadata: { scenario: String(index) }, amount_total: 100 + index });
      expect(() => sdk.webhooks.constructEvent(capture.body, capture.signature, `whsec_scenario_${1 - index}`)).toThrow();
    }
    expect((await control(1, 'state/webhook-deliveries')).map((delivery: { target: string; status: number; attempt: number }) =>
      [delivery.target, delivery.status, delivery.attempt])).toEqual([[targets[1], 200, 1], [targets[1], 200, 2]]);
    expect(await control(0, 'state/webhook-deliveries')).toEqual([]);
  } finally {
    release();
    await pending?.catch(() => {});
    await Promise.all([...hosts.map(host => host.stop()), ...receivers.filter(receiver => receiver.listening).map(receiver => new Promise<void>((resolve, reject) => receiver.close(error => error ? reject(error) : resolve())))]);
  }
}, 15_000);
