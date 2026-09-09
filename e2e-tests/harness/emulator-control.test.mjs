import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EmulatorHost } from '@alga-psa/emulator-host';
import stripe from '@alga-psa/emulator-stripe';
import { EmulatorControl } from '../fixtures/emulator-control.mjs';

test('scenario controls seed the real Stripe wire surface, capture faults, and reset provider effects', async () => {
  const host = new EmulatorHost({ emulators: [stripe], controlPort: 0, ports: { stripe: 0 }, log() {} });
  try {
    const { controlPort, ports } = await host.start();
    const controls = new EmulatorControl(`http://127.0.0.1:${controlPort}`, ['stripe']);
    await controls.reset();
    await controls.seed('stripe', 'config', { secretKey: 'sk_test_private_fixture_secret' });
    const customer = await controls.seed('stripe', 'customer', { email: 'synthetic@example.invalid', name: 'Scenario customer' });
    const vendor = `http://127.0.0.1:${ports.stripe}`;
    const headers = { authorization: 'Bearer sk_test_private_fixture_secret' };
    const response = await fetch(`${vendor}/v1/customers`, { headers });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).data[0].id, customer.id);
    assert.equal((await controls.state('stripe', 'customers'))[0].id, customer.id);

    await controls.arm('stripe', 'transport:error', { status: 429 });
    const failure = await fetch(`${vendor}/v1/customers`, { headers });
    assert.equal(failure.status, 429);
    await failure.text();
    const evidence = await controls.diagnostics();
    assert.equal(evidence.requests.stripe.complete, true);
    assert.deepEqual(evidence.requests.stripe.requests.map(r => [r.method, r.path, r.status]), [
      ['GET', '/v1/customers', 200], ['GET', '/v1/customers', 429],
    ]);
    assert.ok(evidence.operations.some(op => op.path === 'stripe/faults/transport%3Aerror/arm' && op.status === 200));
    assert.equal(JSON.stringify(evidence).includes('sk_test_private_fixture_secret'), false);
    assert.equal(JSON.stringify(evidence).includes('synthetic@example.invalid'), false);

    await controls.reset();
    assert.deepEqual(await controls.state('stripe', 'customers'), []);
    assert.equal((await controls.requests('stripe')).generation, evidence.requests.stripe.generation + 1);
    const restored = await fetch(`${vendor}/v1/customers`, { headers: { authorization: 'Bearer sk_test_algasim' } });
    assert.equal(restored.status, 200);
    assert.deepEqual((await restored.json()).data, []);
  } finally { await host.stop(); }
});

test('control errors expose the failed operation without leaking seed credentials', async () => {
  const host = new EmulatorHost({ emulators: [stripe], controlPort: 0, ports: { stripe: 0 }, log() {} });
  try {
    const { controlPort } = await host.start();
    const controls = new EmulatorControl(`http://127.0.0.1:${controlPort}`, ['stripe']);
    await assert.rejects(controls.seed('stripe', 'customer', { email: 'invalid-secret-value' }),
      { message: 'Emulator control POST stripe/seed/customer returned 400' });
    assert.throws(() => controls.state('qbo', 'invoices'), /outside this scenario/);
    assert.equal(JSON.stringify(await controls.diagnostics()).includes('invalid-secret-value'), false);
    assert.deepEqual(await controls.state('stripe', 'customers'), []);
  } finally { await host.stop(); }
});

test('scenario reset refuses an unfinished vendor operation and succeeds after completion', async () => {
  let arrived;
  let release;
  const started = new Promise(resolve => { arrived = resolve; });
  const waiting = new Promise(resolve => { release = resolve; });
  const probe = {
    id: 'probe', displayName: 'Reset isolation probe', defaultPort: 0,
    createCore: () => ({ reset() {} }), register() {},
    wire(router) { router.get('/pending', async (_req, res) => { arrived(); await waiting; res.json({ done: true }); }); },
  };
  const host = new EmulatorHost({ emulators: [probe], controlPort: 0, log() {} });
  try {
    const { controlPort, ports } = await host.start();
    const controls = new EmulatorControl(`http://127.0.0.1:${controlPort}`, ['probe']);
    const request = fetch(`http://127.0.0.1:${ports.probe}/pending`);
    await started;
    try {
      await assert.rejects(controls.reset(), /vendor requests still in flight/);
      assert.equal((await controls.requests('probe')).generation, 0);
    } finally { release(); }
    assert.deepEqual(await (await request).json(), { done: true });
    await controls.reset();
    assert.equal((await controls.requests('probe')).generation, 1);
  } finally { release(); await host.stop(); }
});
