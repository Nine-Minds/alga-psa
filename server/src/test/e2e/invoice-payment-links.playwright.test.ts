/**
 * Portal invoice payment Playwright specs against the Stripe-like emulator.
 *
 * These are the browser half of the P0 payment-links matrix:
 *
 *  - P0 #4: an authenticated portal user clicks **Pay Now** on an eligible
 *    owned invoice, the simulated hosted Checkout page opens, clicking **Pay**
 *    completes the session, the real signed webhook
 *    (`/api/webhooks/stripe/payments`) is accepted once, and the DB invoice
 *    flips to paid while the payment-success page renders.
 *  - P0 #5: Checkout creation fails (emulator operation fault) → the flagged
 *    `PaymentUnavailable` state renders with **Try again** and **Back to
 *    billing**; after the one-shot fault clears, retrying opens Checkout.
 *
 * Requires the emulator + Stripe env in the webServer, enabled via
 * `PLAYWRIGHT_PAYMENT_LINKS=1`:
 *
 *   PLAYWRIGHT_PAYMENT_LINKS=1 \
 *   DB_NAME_SERVER=<migrated db> \
 *   BASE_URL=http://localhost:<port> \
 *   npx playwright test src/test/e2e/invoice-payment-links.playwright.test.ts
 *
 * When the flag is off the spec is skipped (the emulator is not started and
 * the webServer has no Stripe env).
 */
import { test, expect } from '@playwright/test';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';
import {
  createTestDbConnection,
  createTestTenant,
  createClientUser,
  setupClientAuthSession,
  getBaseUrl,
  applyTestEnvDefaults,
  type TenantTestData,
} from './helpers/testSetup';

const ENABLED = process.env.PLAYWRIGHT_PAYMENT_LINKS === '1';
const BASE_URL = getBaseUrl();
const EMULATOR_BASE = process.env.STRIPE_API_BASE_URL || 'http://127.0.0.1:4050';
const CONTROL_URL = process.env.ALGASIM_CONTROL_URL || 'http://127.0.0.1:9500';
const WEBHOOK_TARGET = `${BASE_URL}/api/webhooks/stripe/payments`;

applyTestEnvDefaults();

function tenantTable(db: Knex, tenantId: string, table: string) {
  return tenantDb(db, tenantId).table(table);
}

async function emulatorControl<T = unknown>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${CONTROL_URL}/control/stripe/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  expect(response.ok, `emulator control ${path}: ${response.status}`).toBe(true);
  return response.json() as Promise<T>;
}

test.describe('client portal invoice payment links', () => {
  let db: Knex;
  let tenantData: TenantTestData;
  let clientId: string;
  let portalUserId: string;
  let portalEmail: string;
  let invoiceId: string;
  let invoiceNumber: string;

  test.beforeAll(async () => {
    if (!ENABLED) return;
    db = createTestDbConnection();
    tenantData = await createTestTenant(db, { companyName: `Invoice Pay Tenant ${Date.now()}` });
    clientId = tenantData.client!.clientId;

    // The tenant fixture client has no billing email; give it one so the
    // shared billing-recipient resolver and Stripe customer creation succeed.
    const billingEmail = `billing-${clientId.slice(0, 8)}@test.com`;
    await tenantTable(db, tenantData.tenant.tenantId, 'clients')
      .where({ client_id: clientId })
      .update({ billing_email: billingEmail });

    const portalUser = await createClientUser(db, tenantData.tenant.tenantId, clientId);
    portalUserId = portalUser.userId;
    portalEmail = portalUser.email;

    // A finalized, unpaid, positive-balance invoice for the portal user's client.
    invoiceId = uuidv4();
    invoiceNumber = `INV-PW-${invoiceId.slice(0, 8).toUpperCase()}`;
    await tenantTable(db, tenantData.tenant.tenantId, 'invoices').insert({
      invoice_id: invoiceId,
      tenant: tenantData.tenant.tenantId,
      client_id: clientId,
      invoice_number: invoiceNumber,
      total_amount: 27500,
      credit_applied: 0,
      currency_code: 'USD',
      status: 'sent',
      invoice_type: 'invoice',
      invoice_date: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      due_date: new Date(Date.now() + 27 * 24 * 60 * 60 * 1000).toISOString(),
      finalized_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    // Enabled Stripe provider with payment links in emails. No vault path: the
    // provider falls back to the app-level STRIPE_* env the webServer carries.
    await tenantTable(db, tenantData.tenant.tenantId, 'payment_provider_configs')
      .insert({
        config_id: uuidv4(),
        tenant: tenantData.tenant.tenantId,
        provider_type: 'stripe',
        is_enabled: true,
        is_default: true,
        configuration: JSON.stringify({ publishable_key: 'pk_test_algasim' }),
        credentials_vault_path: null,
        settings: JSON.stringify({
          paymentLinkExpirationHours: 24,
          paymentLinksInEmails: true,
          sendPaymentConfirmations: true,
        }),
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      })
      .onConflict(['tenant', 'provider_type'])
      .merge();

    // Point the emulator's signed webhook deliveries at the app route.
    await emulatorControl('seed/config', {
      webhookTarget: WEBHOOK_TARGET,
      webhookSecret: 'whsec_algasim',
    });
  });

  test.afterAll(async () => {
    if (!ENABLED) return;
    await db?.destroy();
  });

  test.skip(!ENABLED, 'set PLAYWRIGHT_PAYMENT_LINKS=1 to run the portal payment-link specs');

  async function loginPortalUser(page: import('@playwright/test').Page): Promise<void> {
    await setupClientAuthSession(
      page,
      portalUserId,
      portalEmail,
      tenantData.tenant.tenantId,
      BASE_URL,
      db,
    );
  }

  async function waitForInvoicePaid(timeoutMs = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const row = await tenantTable(db, tenantData.tenant.tenantId, 'invoices')
        .where({ invoice_id: invoiceId })
        .first();
      if (row?.status === 'paid') return;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`invoice ${invoiceId} did not reach paid within ${timeoutMs}ms`);
  }

  // A reset returns the emulator to its just-started state, which clears the
  // configured webhook target, so re-apply the config after every reset.
  async function resetEmulatorWithConfig(): Promise<void> {
    await emulatorControl('reset', {});
    await emulatorControl('seed/config', {
      webhookTarget: WEBHOOK_TARGET,
      webhookSecret: 'whsec_algasim',
    });
  }

  test('Pay Now opens hosted Checkout, hosted Pay settles the invoice through the signed webhook, and the success page renders', async ({ page }) => {
    await resetEmulatorWithConfig();
    await loginPortalUser(page);

    await page.goto(`${BASE_URL}/client-portal/billing/invoices/${invoiceId}/pay`);
    await page.waitForURL(`${EMULATOR_BASE}/checkout/sessions/*`, { timeout: 30_000 });
    expect(await page.title()).toContain('Simulated Stripe Checkout');
    await expect(page.getByRole('button', { name: 'Pay' })).toBeVisible();

    await page.getByRole('button', { name: 'Pay' }).click();

    // The emulator 303s to the app's payment-success route with the session id.
    await page.waitForURL(`${BASE_URL}/client-portal/billing/invoices/${invoiceId}/payment-success?*`, {
      timeout: 30_000,
    });

    // The signed webhook is delivered to the real app handler; the invoice and
    // its ledger settle, and the success UI renders.
    await waitForInvoicePaid();
    await expect(page.getByText(/payment successful|processed successfully/i)).toBeVisible({
      timeout: 30_000,
    });

    const link = await tenantTable(db, tenantData.tenant.tenantId, 'invoice_payment_links')
      .where({ invoice_id: invoiceId })
      .first();
    // The webhook's checkout.session.completed handler marks the link completed.
    expect(link).toBeTruthy();
    expect(link?.status).toBe('completed');
  });

  test('Checkout creation failure shows the flagged failure state, and Try again opens Checkout after the fault clears', async ({ page }) => {
    // A fresh invoice for this test so the creation fault is the only session.
    const freshInvoiceId = uuidv4();
    await tenantTable(db, tenantData.tenant.tenantId, 'invoices').insert({
      invoice_id: freshInvoiceId,
      tenant: tenantData.tenant.tenantId,
      client_id: clientId,
      invoice_number: `INV-PWF-${freshInvoiceId.slice(0, 8).toUpperCase()}`,
      total_amount: 9900,
      credit_applied: 0,
      currency_code: 'USD',
      status: 'sent',
      invoice_type: 'invoice',
      invoice_date: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      due_date: new Date(Date.now() + 27 * 24 * 60 * 60 * 1000).toISOString(),
      finalized_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    await resetEmulatorWithConfig();
    // The Stripe SDK retries 5xx, so fail enough attempts that no session survives.
    await emulatorControl('faults/operation-fault/arm', {
      operation: 'checkout.sessions.create',
      status: 500,
      code: 'api_error',
      message: 'Simulated Stripe outage',
      remaining: 5,
    });

    await loginPortalUser(page);
    await page.goto(`${BASE_URL}/client-portal/billing/invoices/${freshInvoiceId}/pay`);

    // No silent redirect: the flagged PaymentUnavailable state explains the
    // failure and offers retry/back actions.
    await expect(page.getByRole('heading', { name: /payment unavailable/i })).toBeVisible({
      timeout: 30_000,
    });
    const tryAgain = page.getByRole('button', { name: /try again/i });
    const backToBilling = page.getByRole('link', { name: /back to billing/i });
    await expect(tryAgain).toBeVisible();
    await expect(backToBilling).toBeVisible();

    // The fault is one-shot across the SDK's retries; once cleared, retry opens
    // the hosted Checkout for the same invoice.
    await tryAgain.click();
    await page.waitForURL(`${EMULATOR_BASE}/checkout/sessions/*`, { timeout: 30_000 });
    expect(await page.title()).toContain('Simulated Stripe Checkout');
  });

  test('an already-paid invoice redirects to the billing invoices tab instead of starting a payment', async ({ page }) => {
    const paidInvoiceId = uuidv4();
    await tenantTable(db, tenantData.tenant.tenantId, 'invoices').insert({
      invoice_id: paidInvoiceId,
      tenant: tenantData.tenant.tenantId,
      client_id: clientId,
      invoice_number: `INV-PWP-${paidInvoiceId.slice(0, 8).toUpperCase()}`,
      total_amount: 5000,
      credit_applied: 0,
      currency_code: 'USD',
      status: 'paid',
      invoice_type: 'invoice',
      invoice_date: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      due_date: new Date(Date.now() + 27 * 24 * 60 * 60 * 1000).toISOString(),
      finalized_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    await resetEmulatorWithConfig();
    await loginPortalUser(page);
    await page.goto(`${BASE_URL}/client-portal/billing/invoices/${paidInvoiceId}/pay`);

    // already_paid is a non-creation failure: the legacy Billing redirect.
    await page.waitForURL(`${BASE_URL}/client-portal/billing?tab=invoices*`, { timeout: 30_000 });
  });
});
