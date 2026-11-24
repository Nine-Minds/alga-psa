import Stripe from 'stripe';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EmulatorHost } from '@alga-psa/emulator-host';
import stripeEmulator from '../src/index';

/**
 * Billing addresses as Stripe exposes them: on the customer, and on a completed
 * Checkout session's customer_details. Read through the Stripe SDK, the same
 * client the Temporal worker uses to resolve a new tenant's billing address.
 */

let host: EmulatorHost;
let base: string;
let control: string;
let stripe: Stripe;

const SECRET_KEY = 'sk_test_algasim';

async function controlPost(path: string, body?: unknown): Promise<any> {
  const response = await fetch(`${control}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  return response.json();
}

async function seedSubscriptionSession(params: Record<string, unknown> = {}) {
  const customer = await stripe.customers.create({ email: `buyer-${Date.now()}@example.test`, name: 'Buyer' });
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customer.id,
    line_items: [{ price: 'price_addr_test', quantity: 3 }],
    success_url: 'http://localhost:3000/success?session_id={CHECKOUT_SESSION_ID}',
    ...params,
  });
  return { customer, session };
}

beforeAll(async () => {
  host = new EmulatorHost({ emulators: [stripeEmulator], controlPort: 0, ports: { stripe: 0 } });
  const { controlPort, ports } = await host.start();
  base = `http://127.0.0.1:${ports.stripe}`;
  control = `http://127.0.0.1:${controlPort}`;
  await controlPost('/control/stripe/seed/config', { secretKey: SECRET_KEY });
  await controlPost('/control/stripe/seed/price', { id: 'price_addr_test', unitAmount: 1500, interval: 'month' });
  const url = new URL(base);
  stripe = new Stripe(SECRET_KEY, { host: url.hostname, port: Number(url.port), protocol: 'http' });
});

afterAll(async () => {
  await host.stop();
});

describe('stripe emulator billing addresses', () => {
  it('stores a customer address and phone given to the API and returns them on retrieve', async () => {
    const created = await stripe.customers.create({
      email: 'addr@example.test',
      phone: '+1 206 555 0100',
      address: { line1: '1 Main St', city: 'Seattle', state: 'WA', postal_code: '98101', country: 'us' },
    });
    const fetched = await stripe.customers.retrieve(created.id);
    expect(fetched).toMatchObject({
      phone: '+1 206 555 0100',
      address: { line1: '1 Main St', line2: null, city: 'Seattle', state: 'WA', postal_code: '98101', country: 'US' },
    });
  });

  it('defaults a customer without an address to address=null, phone=null', async () => {
    const created = await stripe.customers.create({ email: 'noaddr@example.test' });
    expect(created).toMatchObject({ address: null, phone: null });
  });

  it('seeds a customer address through the control plane', async () => {
    const seeded = await controlPost('/control/stripe/seed/customer', {
      id: 'cus_seeded_addr',
      email: 'seeded@example.test',
      address: { postal_code: 'SW1A 1AA', country: 'GB' },
    });
    expect(seeded.ok).toBe(true);
    expect((await stripe.customers.retrieve('cus_seeded_addr')) as any).toMatchObject({
      address: { line1: null, postal_code: 'SW1A 1AA', country: 'GB' },
    });
  });

  it('leaves customer_details null until the session completes, then carries the billing details', async () => {
    const { customer, session } = await seedSubscriptionSession();
    expect(session.customer_details).toBeNull();
    expect(session.billing_address_collection).toBeNull();

    const completed = await controlPost('/control/stripe/actions/complete-session', {
      sessionId: session.id,
      billingDetails: { address: { postal_code: '98101', country: 'US' } },
    });
    expect(completed.ok).toBe(true);

    const fetched = await stripe.checkout.sessions.retrieve(session.id);
    expect(fetched.status).toBe('complete');
    expect(fetched.customer_details).toEqual({
      email: customer.email,
      name: 'Buyer',
      phone: null,
      address: { line1: null, line2: null, city: null, state: null, postal_code: '98101', country: 'US' },
    });
    // Checkout does not write the address back to the customer.
    expect(((await stripe.customers.retrieve(customer.id)) as Stripe.Customer).address).toBeNull();
  });

  it('completes without billing details with customer_details.address=null', async () => {
    const { session } = await seedSubscriptionSession();
    await controlPost('/control/stripe/actions/complete-session', { sessionId: session.id });
    expect((await stripe.checkout.sessions.retrieve(session.id)).customer_details?.address).toBeNull();
  });

  it('hosted Checkout collects postal code and country by default and the full address when required', async () => {
    const auto = (await seedSubscriptionSession()).session;
    const autoPage = await (await fetch(`${base}/checkout/sessions/${auto.id}`)).text();
    expect(autoPage).toContain('name="address[postal_code]"');
    expect(autoPage).toContain('name="address[country]"');
    expect(autoPage).not.toContain('name="address[line1]"');

    const required = (await seedSubscriptionSession({ billing_address_collection: 'required' })).session;
    expect(required.billing_address_collection).toBe('required');
    const requiredPage = await (await fetch(`${base}/checkout/sessions/${required.id}`)).text();
    expect(requiredPage).toContain('name="address[line1]"');
    expect(requiredPage).toContain('name="address[city]"');

    const pay = await fetch(`${base}/checkout/sessions/${required.id}/pay`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        name: 'Ada Admin',
        'address[line1]': '500 Pike St',
        'address[line2]': '',
        'address[city]': 'Seattle',
        'address[state]': 'WA',
        'address[postal_code]': '98101',
        'address[country]': 'us',
      }).toString(),
    });
    expect(pay.status).toBe(303);
    const fetched = await stripe.checkout.sessions.retrieve(required.id);
    expect(fetched.subscription).toMatch(/^sub_/);
    expect(fetched.customer_details).toMatchObject({
      name: 'Ada Admin',
      address: { line1: '500 Pike St', line2: null, city: 'Seattle', state: 'WA', postal_code: '98101', country: 'US' },
    });
  });
});
