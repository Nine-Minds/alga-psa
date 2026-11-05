import { test as providerTest, expect } from '../fixtures/emulators';
import { signIn, signInPortal } from '../fixtures/auth';
import { createPaymentFixture } from '../fixtures/payment';
import { buildTenantPortalSlug } from '../../shared/utils/tenantSlug';

type PaymentFixture = Awaited<ReturnType<typeof createPaymentFixture>>;
type Session = { id: string; amount_total: number; payment_status: string; status: string; payment_intent: string | null; metadata: { invoice_id: string; tenant_id: string } };
type Delivery = { eventId: string; eventType: string; status: number; attempt: number; response: string };
type Event = { id: string; type: string; data: { object: Session } };

const test = providerTest.extend<{ payment: PaymentFixture }>({
  payment: async ({ database, credentials, emulators, page }, providePayment, testInfo) => {
    const publicURL = process.env.ALGASIM_PUBLIC_STRIPE_URL;
    const callbackBase = process.env.ALGASIM_CALLBACK_BASE_URL;
    if (!publicURL || !callbackBase) throw new Error('Set the public Stripe URL and container-reachable Alga callback base');
    await emulators.seed('stripe', 'config', { hostedBaseUrl: publicURL,
      webhookTarget: `${callbackBase}/api/webhooks/stripe/payments`, webhookSecret: 'whsec_algasim',
    });
    const fixture = await createPaymentFixture(database, credentials.email);
    // Configure this disposable tenant through the shipped connection action.
    // A publishable-only DB row used to make the UI look connected while the
    // payment operation silently depended on an application-wide secret.
    await signIn(page, { email: fixture.tenant.admin.email, password: credentials.password });
    await page.goto('/msp/settings/billing?section=payments');
    await page.getByRole('link', { name: 'Connect Stripe' }).click();
    await page.locator('#connect-stripe-button').click();
    await page.locator('#secretKey').fill('sk_test_algasim');
    await page.locator('#publishableKey').fill('pk_test_algasim');
    await page.locator('#connect-stripe-submit').click();
    await expect(page.locator('#disconnect-stripe')).toBeVisible();
    await expect.poll(async () => {
      const savedConfig = await database('payment_provider_configs')
        .where({ tenant: fixture.tenant.tenantId, provider_type: 'stripe' }).first();
      return savedConfig?.configuration?.stripe_account_id;
    }, { timeout: 15_000 }).toBe('acct_algasim');
    // Portal tests reuse this page, so leave the admin session through the
    // supported portal-switch flow before yielding it to them.
    await page.goto(`/auth/client-portal/signin?tenant=${buildTenantPortalSlug(fixture.tenant.tenantId)}`);
    await page.getByRole('button', { name: 'Sign Out and Switch to Client Portal' }).click();
    await expect(page.locator('[data-automation-id="client-email-field"]')).toBeVisible();
    await testInfo.attach('payment-identities', { body: JSON.stringify(fixture), contentType: 'application/json' });
    await providePayment(fixture);
  },
});
test.use({ emulatorProviders: ['stripe'] });

// Both editions collect this file, but report distinct, accurate case identities.
// CE has a real API capability-boundary assertion; it does not report a passed
// payment journey that only executes in EE.
if (process.env.E2E_EDITION !== 'enterprise') {
  test('community does not expose the enterprise invoice-payment webhook', async ({ request }) => {
    const response = await request.post('/api/webhooks/stripe/payments', { data: {} });
    expect(response.status()).toBe(404);
    expect(await response.json()).toEqual({ error: 'Stripe integration is only available in Enterprise Edition' });
  });
} else {
  test('portal Checkout settles the invoice exactly once through signed webhook delivery and redelivery', async ({ page, payment, credentials, database, emulators }) => {
    test.setTimeout(240000);
    const { tenant, invoice } = payment;
    const where = { tenant: tenant.tenantId, invoice_id: invoice.id };
    await signInPortal(page, { email: tenant.portal.email, password: credentials.password }, tenant.tenantId);
    await page.goto(`/client-portal/billing/invoices/${invoice.id}/pay`);
    await expect(page).toHaveURL(new RegExp(`^${process.env.ALGASIM_PUBLIC_STRIPE_URL!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/checkout/sessions/`));
    await expect(page.getByRole('button', { name: 'Pay', exact: true })).toBeVisible();
    const sessions = await emulators.state<Session[]>('stripe', 'checkout-sessions');
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ amount_total: invoice.amountCents, payment_status: 'unpaid',
      metadata: { tenant_id: tenant.tenantId, invoice_id: invoice.id } });
    await page.getByRole('button', { name: 'Pay', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/invoices/${invoice.id}/payment-success\\?`));
    await expect(page.getByRole('heading', { name: 'Payment Successful!' })).toBeVisible();
    await expect(page.getByText(invoice.number, { exact: false })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Payment Successful!' })).toBeVisible();

    await expect.poll(async () => (await database('invoices').where(where).first())?.status).toBe('paid');
    const payments = await database('invoice_payments').where(where);
    expect(payments).toHaveLength(1);
    expect(Number(payments[0].amount)).toBe(invoice.amountCents);
    expect(payments[0].payment_method).toBe('stripe');
    const balance = await database('invoices').where(where).first();
    expect(Number(balance.total_amount) - Number(balance.credit_applied) - Number(payments[0].amount)).toBe(0);
    const transactions = await database('transactions').where({ ...where, type: 'payment' });
    expect(transactions).toHaveLength(1);
    expect(Number(transactions[0].amount)).toBe(invoice.amountCents);
    expect(await database('invoice_payment_links').where(where).select('status')).toEqual([{ status: 'completed' }]);

    const events = await emulators.state<Event[]>('stripe', 'events');
    const completed = events.filter(event => event.type === 'checkout.session.completed');
    expect(completed).toHaveLength(1);
    const eventId = completed[0].id;
    const first = (await emulators.state<Delivery[]>('stripe', 'webhook-deliveries')).filter(item => item.eventId === eventId);
    expect(first).toHaveLength(1);
    expect(first[0].status).toBe(200);
    expect(JSON.parse(first[0].response)).toMatchObject({ processed: true, paymentRecorded: true });
    await emulators.action('stripe', 'redeliver-event', { eventId });
    const deliveries = (await emulators.state<Delivery[]>('stripe', 'webhook-deliveries')).filter(item => item.eventId === eventId);
    expect(deliveries.map(item => item.status)).toEqual([200, 200]);
    expect(deliveries.map(item => item.attempt)).toEqual([1, 2]);
    expect(JSON.parse(deliveries[1].response)).toMatchObject({ processed: true, paymentRecorded: false });
    expect(await database('invoice_payments').where(where)).toEqual(payments);
    expect(await database('transactions').where({ ...where, type: 'payment' })).toEqual(transactions);
    expect(await database('payment_webhook_events').where({ tenant: tenant.tenantId, external_event_id: eventId })
      .select('processed', 'processing_status')).toEqual([{ processed: true, processing_status: 'completed' }]);
    const history = await emulators.requests('stripe');
    expect(history.complete).toBe(true);
    expect(history.requests).toEqual(expect.arrayContaining([
      expect.objectContaining({ method: 'POST', path: '/v1/checkout/sessions', status: 200 }),
      expect.objectContaining({ method: 'POST', path: `/checkout/sessions/${sessions[0].id}/pay`, status: 303 }),
    ]));
  });

  test('declined and cancelled Checkout leaves the invoice unpaid and creates no payment ledger entry', async ({ page, payment, credentials, database, emulators }) => {
    const { tenant, invoice } = payment;
    const where = { tenant: tenant.tenantId, invoice_id: invoice.id };
    await signInPortal(page, { email: tenant.portal.email, password: credentials.password }, tenant.tenantId);
    await page.goto(`/client-portal/billing/invoices/${invoice.id}/pay`);
    await page.getByRole('button', { name: 'Decline', exact: true }).click();
    await expect(page.getByText('Your card was declined.', { exact: true })).toBeVisible();
    const deliveries = await emulators.state<Delivery[]>('stripe', 'webhook-deliveries');
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({ eventType: 'payment_intent.payment_failed', status: 200 });
    expect(JSON.parse(deliveries[0].response)).toMatchObject({ processed: true, paymentRecorded: false });
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page).toHaveURL(/\/client-portal\/billing(?:[?/#]|$)/);
    await page.reload();
    expect((await database('invoices').where(where).first()).status).toBe('sent');
    expect(await database('invoice_payments').where(where)).toEqual([]);
    expect(await database('transactions').where({ ...where, type: 'payment' })).toEqual([]);
    expect((await emulators.state<Session[]>('stripe', 'checkout-sessions'))[0].payment_status).toBe('unpaid');
  });

  test('Checkout creation failure offers a retry and recovers for the same unpaid invoice', async ({ page, payment, credentials, database, emulators }) => {
    const { tenant, invoice } = payment;
    await emulators.arm('stripe', 'operation-fault', { operation: 'checkout.sessions.create', status: 500, remaining: 100 });
    await signInPortal(page, { email: tenant.portal.email, password: credentials.password }, tenant.tenantId);
    await page.goto(`/client-portal/billing/invoices/${invoice.id}/pay`);
    await expect(page.getByRole('heading', { name: 'Payment Unavailable' })).toBeVisible();
    expect(await emulators.state('stripe', 'checkout-sessions')).toEqual([]);
    expect((await database('invoices').where({ tenant: tenant.tenantId, invoice_id: invoice.id }).first()).status).toBe('sent');
    expect((await emulators.requests('stripe')).requests).toEqual(expect.arrayContaining([
      expect.objectContaining({ method: 'POST', path: '/v1/checkout/sessions', status: 500 }),
    ]));
    await emulators.disarm('stripe', 'operation-fault');
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Pay', exact: true })).toBeVisible();
    const sessions = await emulators.state<Session[]>('stripe', 'checkout-sessions');
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ amount_total: invoice.amountCents, metadata: { invoice_id: invoice.id, tenant_id: tenant.tenantId } });
  });
}
