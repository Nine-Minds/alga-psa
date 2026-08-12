/**
 * Journey: invoice email payment links (direct MSP send) against the
 * Stripe-like emulator.
 *
 * P0 behavioral-matrix rows exercised here:
 *
 *  1. Direct Send Invoice Email with links: a finalized, unpaid invoice sent
 *     through the real `sendInvoiceEmailAction` carries a working emulator
 *     Checkout URL and an authenticated portal URL; the Stripe customer is
 *     created with the billing-contact email; the invoice PDF stays attached.
 *  2. Billing contact with a blank email falls through to `clients.billing_email`
 *     for BOTH delivery and Stripe customer creation; two direct sends reuse one
 *     active `invoice_payment_links` row and one emulator Checkout session.
 *  3. `checkout.sessions.create` operation fault: the email still sends with a
 *     portal CTA and no payment CTA, and the logged error retains the emulator
 *     message.
 *  6. Tenant/ownership boundary: a portal user whose contact belongs to another
 *     client cannot obtain a payment link and the provider receives no request.
 *
 * The only mocked seams are auth/persona plumbing, the email transport
 * (captured instead of SMTP), PDF generation (returning a byte attachment),
 * and the CE→EE payment-module redirect (`@enterprise` → the real
 * `ee/server/src` implementation, matching the production webpack alias).
 */

import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import knex from 'knex';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';

import { tenantDb } from '@alga-psa/db';
import { EmulatorHost } from '@alga-psa/emulator-host';
import stripeEmulator from '@alga-psa/emulator-stripe';
import { PaymentLinkError } from '@alga-psa/billing/actions/paymentLinkError';
import { getSecret } from '../../../lib/utils/getSecret';

let db: Knex;
let tenantId: string;
// The withAuth mock reads this at call time so each step runs as the right persona.
let activeActor: any;
// Captured emails from the mocked system provider.
const capturedEmails: Array<{ message: any; tenant?: string }> = [];

function tenantTable<Row extends object = Record<string, unknown>>(
  connection: Knex,
  tenant: string,
  tableExpression: string
): Knex.QueryBuilder<Row, Row[]> {
  return tenantDb(connection, tenant).table<Row>(tableExpression);
}

function tenantRows(connection: Knex): Knex.QueryBuilder<Record<string, unknown>, Record<string, unknown>[]> {
  return tenantDb(connection, '__test_tenant_fixture__')
    .unscoped('tenants', 'test fixture creates and removes tenant rows');
}

vi.mock('server/src/lib/db', async () => {
  const actual = await vi.importActual<typeof import('server/src/lib/db')>('server/src/lib/db');
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({ knex: db, tenant: tenantId })),
    getCurrentTenantId: vi.fn(async () => tenantId ?? null),
    runWithTenant: vi.fn(async (_tenant: string, fn: () => Promise<any>) => fn())
  };
});

vi.mock('@alga-psa/db', async () => {
  const actual = await vi.importActual<typeof import('@alga-psa/db')>('@alga-psa/db');
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({ knex: db, tenant: tenantId })),
    getConnection: vi.fn(async () => db),
    withTransaction: vi.fn(async (knexOrTrx: Knex, callback: (trx: Knex.Transaction) => Promise<unknown>) =>
      callback(knexOrTrx as unknown as Knex.Transaction),
    ),
    requireTenantId: vi.fn(async () => tenantId),
    runWithTenant: vi.fn(async (_tenant: string, fn: () => Promise<any>) => fn()),
  };
});

vi.mock('server/src/lib/tenant', () => ({
  getTenantForCurrentRequest: vi.fn(async () => tenantId ?? null),
  getTenantFromHeaders: vi.fn(() => tenantId ?? null)
}));

// PaymentService / StripePaymentProvider read their connection through this seam.
vi.mock('server/src/lib/db/db', () => ({
  getConnection: vi.fn(async () => db),
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(async () => true),
}));

// The server vitest setup globally mocks the @alga-psa/auth barrel: its
// `withAuth` resolves the caller through `getCurrentUser` (see setup.ts). The
// persona is therefore driven by overriding that mock per test, exactly like
// the other journey tests do.
import { getCurrentUser } from '@alga-psa/auth';

// The billing payment-action layer resolves the actor through the separate
// `@alga-psa/auth/getCurrentUser` specifier (see billing authHelpers), so it
// needs its own persona-driving mock that reads the same activeActor.
vi.mock('@alga-psa/auth/getCurrentUser', async () => {
  const actual = await vi.importActual<typeof import('@alga-psa/auth/getCurrentUser')>('@alga-psa/auth/getCurrentUser');
  return {
    ...actual,
    getCurrentUser: vi.fn(async () => activeActor),
  };
});

function setActiveActor(user: any): void {
  activeActor = user;
  vi.mocked(getCurrentUser).mockImplementation(async () => user);
}

// The billing payment-action layer dynamically imports the enterprise module;
// the production webpack alias maps @enterprise to ee/server/src when EDITION=ee,
// so point it at the real implementation for the test run as well.
vi.mock('@enterprise/lib/payments', async () => {
  const ee = await import('@ee/lib/payments');
  return {
    PaymentService: ee.PaymentService,
    createStripePaymentProvider: ee.createStripePaymentProvider,
  };
});

// Emulator credentials are fixtures, not secrets; the tenant secret path is
// short-circuited so the provider initializes against the emulator.
vi.mock('@alga-psa/core/secrets', async () => {
  const actual = await vi.importActual<typeof import('@alga-psa/core/secrets')>('@alga-psa/core/secrets');
  return {
    ...actual,
    getSecretProviderInstance: vi.fn(async () => ({
      getTenantSecret: vi.fn(async (_tenant: string, key: string) => {
        if (key === 'stripe_payment_secret_key') return 'sk_test_algasim';
        if (key === 'stripe_payment_webhook_secret') return 'whsec_algasim';
        return undefined;
      }),
      getAppSecret: vi.fn(async (key: string) => {
        if (key === 'stripe_secret_key') return 'sk_test_algasim';
        if (key === 'stripe_payment_webhook_secret' || key === 'stripe_webhook_secret') return 'whsec_algasim';
        if (key === 'stripe_publishable_key') return 'pk_test_algasim';
        return undefined;
      }),
    })),
  };
});

// Capture the outgoing invoice email instead of delivering it over SMTP.
vi.mock('@alga-psa/email', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/email')>();
  return {
    ...actual,
    SystemEmailProviderFactory: {
      getConfigFingerprint: () => 'test-capture',
      createProvider: vi.fn(async () => ({
        providerType: 'capture',
        sendEmail: async (message: any, tenant?: string) => {
          capturedEmails.push({ message, tenant });
          return { success: true };
        },
      })),
    },
  };
});

// Real PDF rendering is not needed here; the attachment bytes matter. The
// action imports createPDFGenerationService through the relative
// services/pdfGenerationService path, so mock that resolved module directly
// (a mock of the @alga-psa/billing/services barrel does not intercept it).
vi.mock('@alga-psa/billing/services/pdfGenerationService', () => ({
  createPDFGenerationService: vi.fn(() => ({
    generateAndStore: vi.fn(async () => ({ file_id: `file-${uuidv4()}` })),
  })),
  PDFGenerationService: class {},
}));

vi.mock('@alga-psa/billing/services', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/billing/services')>();
  return {
    ...actual,
    createPDFGenerationService: vi.fn(() => ({
      generateAndStore: vi.fn(async () => ({ file_id: `file-${uuidv4()}` })),
    })),
  };
});

vi.mock('@alga-psa/storage/StorageService', () => ({
  StorageService: {
    downloadFile: vi.fn(async () => ({ buffer: Buffer.from('%PDF-1.4 journey-invoice-payment-links') })),
  },
}));

// Payment ledger transactions go through recordTransaction; the webhook path is
// covered by the Playwright spec, so keep this seam inert here.
vi.mock('server/src/lib/utils/transactionUtils', () => ({
  recordTransaction: vi.fn(async () => ({ transaction_id: uuidv4() })),
}));

// The direct send and payment actions never touch Redis; keep the publisher inert.
vi.mock('server/src/lib/eventBus/publishers', () => ({
  publishEvent: vi.fn(async () => undefined),
  publishWorkflowEvent: vi.fn(async () => undefined),
}));

// Capture server-side payment-link failures for the cause-retention assertion.
const loggerError = vi.fn();
const loggerWarn = vi.fn();
const loggerInfo = vi.fn();
const loggerDebug = vi.fn();
vi.mock('@alga-psa/core/logger', () => ({
  default: {
    info: (...args: unknown[]) => loggerInfo(...args),
    warn: (...args: unknown[]) => loggerWarn(...args),
    error: (...args: unknown[]) => loggerError(...args),
    debug: (...args: unknown[]) => loggerDebug(...args),
  },
}));

const HOOK_TIMEOUT = 240_000;

describe('journey: invoice email payment links against the Stripe emulator', () => {
  let host: EmulatorHost;
  let stripeBase: string;
  let stripeControlUrl: string;

  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    process.env.NODE_ENV = 'test';
    process.env.EDITION = 'ee';
    process.env.NEXT_PUBLIC_EDITION = 'enterprise';
    process.env.NEXT_PUBLIC_BASE_URL = 'http://localhost:3000';
    process.env.EMAIL_FROM = 'billing@msp.test';

    // A deterministic, disposable database shared by the DB-backed rows. The
    // CE and EE chains must run through ONE Knex migrator against a fresh
    // database (as the admin role, which is required for CREATE EXTENSION):
    // the combined list is executed in a single sorted sequence, so migrations
    // that depend on tables created by either chain resolve correctly.
    db = await bootstrapJourneyDb();

    tenantId = await ensureTenant(db);

    // Start the Stripe-like emulator in-process; its /v1 origin becomes the
    // SDK base URL before any provider is constructed.
    host = new EmulatorHost({ emulators: [stripeEmulator], controlPort: 0, ports: { stripe: 0 } });
    const { controlPort, ports } = await host.start();
    stripeControlUrl = `http://127.0.0.1:${controlPort}`;
    stripeBase = `http://127.0.0.1:${ports.stripe}`;
    process.env.STRIPE_API_BASE_URL = stripeBase;
    process.env.STRIPE_SECRET_KEY = 'sk_test_algasim';
    process.env.STRIPE_PAYMENT_WEBHOOK_SECRET = 'whsec_algasim';
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_test_algasim';

    // The suite shuffles tests; a default persona guards tests that somehow run
    // before any explicit assignment (every test overrides this anyway).
    setActiveActor({
      user_id: 'journey-default-user',
      tenant: tenantId,
      roles: [{ role_name: 'Admin' }],
    });
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await host?.stop();
    await db?.destroy();
  }, HOOK_TIMEOUT);

  describe('direct send with payment links enabled', () => {
    it('sends a finalized invoice with a Checkout URL and portal URL; the customer uses the billing contact email', async () => {
      await resetSharedState();
      const clientId = uuidv4();
      const invoiceId = uuidv4();
      const contactEmail = `contact-${uuidv4().slice(0, 8)}@acme.test`;

      await seedClientWithBillingContact(db, tenantId, clientId, contactEmail);
      await seedFinalizedInvoice(db, tenantId, clientId, invoiceId, 25000);
      await upsertProviderConfig(db, tenantId);

      setActiveActor({
        user_id: 'journey-msp-user',
        tenant: tenantId,
        roles: [{ role_name: 'Admin' }],
      });

      const { sendInvoiceEmailAction } = await import('@alga-psa/billing/actions/invoiceJobActions');
      const result = await sendInvoiceEmailAction([invoiceId], '');
      expect(result, JSON.stringify(result)).toEqual({
        successCount: 1,
        failureCount: 0,
        results: [{ success: true, invoiceNumber: expect.stringContaining('INV-'), recipientEmail: contactEmail }],
      });

      // One email captured with the billing contact as recipient.
      expect(capturedEmails.length).toBe(1);
      const { message } = capturedEmails[capturedEmails.length - 1];
      expect(message.to).toEqual([{ email: contactEmail, name: 'Jane Billing' }]);

      // The PDF attachment survived the round-trip.
      const attachment = message.attachments[0];
      expect(attachment.filename).toContain('Invoice_INV-');
      expect(Buffer.isBuffer(attachment.content)).toBe(true);
      expect(attachment.content.toString('utf8')).toContain('%PDF-');

      // The email renders both CTAs: the emulator Checkout URL and the portal
      // URL. Handlebars HTML-escapes attribute values, so the portal URL's
      // `&`/`=` render as entities; the plain-text form is unescaped.
      const html = String(message.html);
      const text = String(message.text);
      const escapedPortalUrl = 'http://localhost:3000/client-portal/billing?tab&#x3D;invoices&amp;invoiceId&#x3D;' + invoiceId;
      expect(html).toContain('client-portal/billing');
      expect(html).toContain(escapedPortalUrl);
      expect(html).toContain(invoiceId);
      expect(text).toContain('http://localhost:3000/client-portal/billing?tab=invoices&invoiceId=' + invoiceId);
      // The system template from the migration renders the localized CTA labels.
      expect(html).toContain('Pay now');
      expect(html).toContain('View invoice in client portal');

      // A Stripe customer was created for the billing contact email and a single
      // Checkout session exists with this invoice's metadata.
      const customers = await emulatorState('customers');
      expect(customers).toHaveLength(1);
      expect(customers[0].email).toBe(contactEmail);
      const sessions = await emulatorState('checkout-sessions');
      expect(sessions).toHaveLength(1);
      expect(sessions[0].metadata.invoice_id).toBe(invoiceId);

      // The captured email carries that session's hosted Checkout URL.
      const sessionUrl = sessions[0].url;
      expect(sessionUrl).toContain(stripeBase);
      expect(html).toContain(sessionUrl);
      expect(text).toContain(sessionUrl);

      // The compatibility renderer must not duplicate the CTAs: the session
      // URL appears exactly once in the decoded HTML (the system template's
      // primary action) and once in the decoded text.
      const decodedHtml = html.replace(/&#x3D;/gi, '=').replace(/&amp;/g, '&');
      expect(decodedHtml.split(sessionUrl).length - 1).toBe(1);
      expect(text.split(sessionUrl).length - 1).toBe(1);

      // The mapping table records the emulator customer for the client.
      const mappings = await tenantTable(db, tenantId, 'client_payment_customers')
        .where({ client_id: clientId, provider_type: 'stripe' });
      expect(mappings).toHaveLength(1);
      expect(mappings[0].email).toBe(contactEmail);
      expect(mappings[0].external_customer_id).toBe(customers[0].id);

      // One active DB payment link row for the invoice.
      const links = await tenantTable(db, tenantId, 'invoice_payment_links')
        .where({ invoice_id: invoiceId, status: 'active' });
      expect(links).toHaveLength(1);
      expect(links[0].external_link_id).toBe(sessions[0].id);
    }, HOOK_TIMEOUT);

    it('falls through a blank billing-contact email to clients.billing_email and reuses one link across two sends', async () => {
      await resetSharedState();
      const clientId = uuidv4();
      const invoiceId = uuidv4();
      const billingEmail = `billing-${uuidv4().slice(0, 8)}@acme.test`;

      // The contact row exists but has a blank email; clients.billing_email wins.
      await seedClientWithBillingContact(db, tenantId, clientId, '');
      await tenantTable(db, tenantId, 'clients')
        .where({ client_id: clientId })
        .update({ billing_email: billingEmail });
      await seedFinalizedInvoice(db, tenantId, clientId, invoiceId, 32000);
      await upsertProviderConfig(db, tenantId);

      setActiveActor({
        user_id: 'journey-msp-user',
        tenant: tenantId,
        roles: [{ role_name: 'Admin' }],
      });

      const { sendInvoiceEmailAction } = await import('@alga-psa/billing/actions/invoiceJobActions');

      const first = await sendInvoiceEmailAction([invoiceId], '');
      expect(first.successCount).toBe(1);
      expect(first.results[0].recipientEmail).toBe(billingEmail);
      const second = await sendInvoiceEmailAction([invoiceId], '');
      expect(second.successCount).toBe(1);
      expect(second.results[0].recipientEmail).toBe(billingEmail);

      // Both sends resolved the recipient from clients.billing_email.
      expect(capturedEmails).toHaveLength(2);
      expect(capturedEmails[0].message.to[0].email).toBe(billingEmail);
      expect(capturedEmails[1].message.to[0].email).toBe(billingEmail);

      // Sequential idempotency: exactly one active link row and exactly one
      // emulator session were created across both sends.
      const links = await tenantTable(db, tenantId, 'invoice_payment_links')
        .where({ invoice_id: invoiceId, status: 'active' });
      expect(links).toHaveLength(1);
      const sessions = await emulatorState('checkout-sessions');
      expect(sessions).toHaveLength(1);
      expect(links[0].external_link_id).toBe(sessions[0].id);

      // The Stripe customer for this client carries the resolved billing email.
      const customer = await tenantTable(db, tenantId, 'client_payment_customers')
        .where({ client_id: clientId, provider_type: 'stripe' })
        .first();
      expect(customer?.email).toBe(billingEmail);
    }, HOOK_TIMEOUT);

    it('deterministically sends to the chosen active billing location when multiple billing locations and a default exist', async () => {
      await resetSharedState();
      const clientId = uuidv4();
      const invoiceId = uuidv4();
      const chosenBillingEmail = `chosen-billing-${uuidv4().slice(0, 8)}@acme.test`;
      const otherBillingEmail = `other-billing-${uuidv4().slice(0, 8)}@acme.test`;
      const defaultEmail = `default-${uuidv4().slice(0, 8)}@acme.test`;
      const tiedCreatedAt = new Date('2025-01-01T00:00:00.000Z');

      await seedClientRow(db, tenantId, clientId, 'Duplicate Locations');
      await tenantTable(db, tenantId, 'client_locations')
        .where({ client_id: clientId })
        .update({
          is_billing_address: false,
          is_default: true,
          email: defaultEmail,
          created_at: new Date('2024-01-01T00:00:00.000Z'),
        });

      // All billing rows have the same creation time. The first ordered row is
      // invalid and is skipped; location_id then chooses the first valid row,
      // while billing precedence keeps it ahead of the older default location.
      await seedClientLocation(db, tenantId, clientId, {
        locationId: '00000000-0000-4000-8000-000000000000',
        email: 'not-an-email',
        isBilling: true,
        isDefault: false,
        createdAt: tiedCreatedAt,
      });
      await seedClientLocation(db, tenantId, clientId, {
        locationId: '00000000-0000-4000-8000-000000000002',
        email: otherBillingEmail,
        isBilling: true,
        isDefault: false,
        createdAt: tiedCreatedAt,
      });
      await seedClientLocation(db, tenantId, clientId, {
        locationId: '00000000-0000-4000-8000-000000000001',
        email: chosenBillingEmail,
        isBilling: true,
        isDefault: false,
        createdAt: tiedCreatedAt,
      });
      await seedFinalizedInvoice(db, tenantId, clientId, invoiceId, 18000);
      await upsertProviderConfig(db, tenantId);

      setActiveActor({
        user_id: 'journey-msp-user',
        tenant: tenantId,
        roles: [{ role_name: 'Admin' }],
      });

      const { sendInvoiceEmailAction } = await import('@alga-psa/billing/actions/invoiceJobActions');
      const result = await sendInvoiceEmailAction([invoiceId], '');
      expect(result.successCount).toBe(1);
      expect(result.results[0].recipientEmail).toBe(chosenBillingEmail);
      expect(capturedEmails[0].message.to).toEqual([{ email: chosenBillingEmail, name: expect.any(String) }]);

      const customers = await emulatorState('customers');
      expect(customers).toHaveLength(1);
      expect(customers[0].email).toBe(chosenBillingEmail);
    }, HOOK_TIMEOUT);

    it('expires and replaces an active Checkout session when credits and prior payments reduce the balance', async () => {
      await resetSharedState();
      const clientId = uuidv4();
      const invoiceId = uuidv4();
      await seedClientWithBillingContact(db, tenantId, clientId, `balance-${uuidv4().slice(0, 8)}@acme.test`);
      await seedFinalizedInvoice(db, tenantId, clientId, invoiceId, 32000);
      await upsertProviderConfig(db, tenantId);

      setActiveActor({
        user_id: 'journey-msp-user',
        tenant: tenantId,
        roles: [{ role_name: 'Admin' }],
      });

      const { sendInvoiceEmailAction } = await import('@alga-psa/billing/actions/invoiceJobActions');
      const first = await sendInvoiceEmailAction([invoiceId], '');
      expect(first.successCount).toBe(1);

      const [originalSession] = await emulatorState('checkout-sessions');
      expect(originalSession.amount_total).toBe(32000);
      expect(originalSession.status).toBe('open');

      // The current payable amount becomes 32,000 - 3,000 credit - 5,000
      // prior payment = 24,000 cents while the first link is still active.
      await tenantTable(db, tenantId, 'invoices')
        .where({ invoice_id: invoiceId })
        .update({ credit_applied: 3000, updated_at: db.fn.now() });
      await tenantTable(db, tenantId, 'invoice_payments').insert({
        payment_id: uuidv4(),
        tenant: tenantId,
        invoice_id: invoiceId,
        amount: 5000,
        payment_method: 'manual',
        status: 'completed',
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      });

      const second = await sendInvoiceEmailAction([invoiceId], '');
      expect(second.successCount).toBe(1);

      const sessions = await emulatorState('checkout-sessions');
      expect(sessions).toHaveLength(2);
      const expiredSession = sessions.find((session) => session.id === originalSession.id);
      const replacementSession = sessions.find((session) => session.id !== originalSession.id);
      expect(expiredSession?.status).toBe('expired');
      expect(replacementSession?.status).toBe('open');
      expect(replacementSession?.amount_total).toBe(24000);

      const links = await tenantTable(db, tenantId, 'invoice_payment_links')
        .where({ invoice_id: invoiceId });
      expect(links).toHaveLength(2);
      const staleLink = links.find((link) => link.external_link_id === originalSession.id);
      const replacementLink = links.find((link) => link.external_link_id === replacementSession?.id);
      expect(staleLink?.status).toBe('expired');
      expect(staleLink?.metadata).toMatchObject({
        stale_balance: true,
        stored_amount: 32000,
        current_balance: 24000,
      });
      expect(replacementLink?.status).toBe('active');
      expect(Number(replacementLink?.amount)).toBe(24000);

      const secondEmailHtml = String(capturedEmails[1].message.html);
      expect(secondEmailHtml).toContain(replacementSession?.url);
      expect(secondEmailHtml).not.toContain(originalSession.url);
    }, HOOK_TIMEOUT);

    it('degrades to a portal-only email with the cause retained when Checkout creation fails', async () => {
      await resetSharedState();
      const clientId = uuidv4();
      const invoiceId = uuidv4();
      await seedClientWithBillingContact(db, tenantId, clientId, `fault-${uuidv4().slice(0, 8)}@acme.test`);
      await seedFinalizedInvoice(db, tenantId, clientId, invoiceId, 15000);
      await upsertProviderConfig(db, tenantId);

      // The emulator's checkout.sessions.create fails with a Stripe envelope.
      // The Stripe SDK retries 5xx responses, so arm the fault across enough
      // attempts that every retry fails and no session can be created.
      await controlPost('faults/operation-fault/arm', {
        operation: 'checkout.sessions.create',
        status: 500,
        code: 'api_error',
        message: 'Simulated Stripe outage',
        remaining: 5,
      });

      setActiveActor({
        user_id: 'journey-msp-user',
        tenant: tenantId,
        roles: [{ role_name: 'Admin' }],
      });

      const { sendInvoiceEmailAction } = await import('@alga-psa/billing/actions/invoiceJobActions');
      loggerError.mockClear();
      const result = await sendInvoiceEmailAction([invoiceId], '');
      expect(result.successCount).toBe(1);

      // No Checkout session survived the retried failures.
      expect(await emulatorState('checkout-sessions')).toHaveLength(0);

      // The email still sends with a portal CTA and no payment CTA.
      expect(capturedEmails).toHaveLength(1);
      const { message } = capturedEmails[capturedEmails.length - 1];
      const html = String(message.html);
      expect(html).toContain('client-portal/billing');
      expect(html).toContain(invoiceId);
      expect(html).not.toContain(stripeBase);
      // No broken CTA: neither a "Pay now" primary button nor a checkout URL.
      expect(html).not.toMatch(/Pay now[^<]*<\/a>/);
      expect(html).not.toContain('/checkout/sessions/');

      // No payment link row was persisted for the failed creation.
      const links = await tenantTable(db, tenantId, 'invoice_payment_links')
        .where({ invoice_id: invoiceId });
      expect(links).toHaveLength(0);

      // The server-side failure retained the emulator's message.
      expect(loggerError).toHaveBeenCalled();
      const paymentCall = loggerError.mock.calls.find((call) => String(call[0]).includes('Failed to create payment link'));
      expect(paymentCall).toBeDefined();
      const logged = paymentCall![1];
      const errorField = (logged as any).error;
      expect(String(errorField?.message ?? errorField)).toContain('Simulated Stripe outage');
    }, HOOK_TIMEOUT);

    it('surfaces a portal provider failure as PaymentLinkError with the cause retained', async () => {
      await resetSharedState();
      const clientId = uuidv4();
      const invoiceId = uuidv4();
      await seedClientWithBillingContact(db, tenantId, clientId, `portal-${uuidv4().slice(0, 8)}@acme.test`);
      await seedFinalizedInvoice(db, tenantId, clientId, invoiceId, 15000);
      await upsertProviderConfig(db, tenantId);

      const contact = await tenantTable(db, tenantId, 'contacts')
        .where({ client_id: clientId })
        .first();
      const contactId = String(contact?.contact_name_id);

      // The emulator's checkout.sessions.create fails; the SDK retries 5xx
      // responses, so arm the fault across enough attempts to exhaust every retry.
      await controlPost('faults/operation-fault/arm', {
        operation: 'checkout.sessions.create',
        status: 500,
        code: 'api_error',
        message: 'Simulated Stripe outage',
        remaining: 5,
      });

      setActiveActor({
        user_id: 'journey-portal-owner',
        tenant: tenantId,
        contact_id: contactId,
        roles: [],
      });

      loggerError.mockClear();
      const { getClientPortalInvoicePaymentLink } = await import(
        '@alga-psa/client-portal/actions/clientPaymentActions'
      );
      const result = await getClientPortalInvoicePaymentLink(invoiceId);
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('payment_link_creation_failed');
      expect(result.error?.retryable).toBe(true);
      // The browser receives only the stable safe message, never provider internals.
      expect(result.error?.message).toBe('We could not start the payment. Please try again.');

      // The billing-action boundary rethrew the provider failure as a typed
      // `PaymentLinkError` whose native `cause` is the original exception. It is
      // logged server-side as an error object and never serialized to the client.
      const portalCall = loggerError.mock.calls.find((call) =>
        String(call[0]).includes('[ClientPayment] Failed to get payment link')
      );
      expect(portalCall).toBeDefined();
      const thrown = (portalCall![1] as { error?: unknown }).error;
      expect(thrown).toBeInstanceOf(PaymentLinkError);
      expect((thrown as PaymentLinkError).code).toBe('payment_link_creation_failed');
      expect((thrown as PaymentLinkError).cause).toBeTruthy();
      const causeMessage =
        ((thrown as PaymentLinkError).cause as Error | undefined)?.message ??
        String((thrown as PaymentLinkError).cause);
      expect(causeMessage).toContain('Simulated Stripe outage');
    }, HOOK_TIMEOUT);

    it('does not create a payment link or call the provider for a foreign client, and discloses no invoice data', async () => {
      await resetSharedState();
      // Owner client + owned invoice.
      const ownerClientId = uuidv4();
      const invoiceId = uuidv4();
      await seedClientWithBillingContact(db, tenantId, ownerClientId, `owner-${uuidv4().slice(0, 8)}@acme.test`);
      await seedFinalizedInvoice(db, tenantId, ownerClientId, invoiceId, 5000);

      // Another client whose portal user tries to pay the owner's invoice.
      const foreignClientId = uuidv4();
      const contactId = uuidv4();
      await seedClientRow(db, tenantId, foreignClientId, 'Other Corp');
      await tenantTable(db, tenantId, 'contacts').insert({
        contact_name_id: contactId,
        tenant: tenantId,
        full_name: 'Other Contact',
        email: `other-${uuidv4().slice(0, 8)}@acme.test`,
        client_id: foreignClientId,
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      });
      await upsertProviderConfig(db, tenantId);

      const sessionsBefore = (await emulatorState('checkout-sessions')).length;
      setActiveActor({
        user_id: 'journey-portal-foreign',
        tenant: tenantId,
        contact_id: contactId,
        roles: [],
      });

      const { getClientPortalInvoicePaymentLink } = await import(
        '@alga-psa/client-portal/actions/clientPaymentActions'
      );
      const result = await getClientPortalInvoicePaymentLink(invoiceId);
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('access_denied');
      // The safe browser-facing message discloses no invoice or client data.
      expect(result.error?.message).toBe('Access denied');
      expect(result.error?.retryable).toBe(false);

      // The provider never saw the request and no link/ledger row changed.
      expect((await emulatorState('checkout-sessions')).length).toBe(sessionsBefore);
      expect(await tenantTable(db, tenantId, 'invoice_payment_links').where({ invoice_id: invoiceId })).toHaveLength(0);
      expect(await tenantTable(db, tenantId, 'client_payment_customers').where({ client_id: ownerClientId })).toHaveLength(0);
    }, HOOK_TIMEOUT);
  });

  describe('shared billing-recipient resolver precedence', () => {
    it('walks the full precedence: contact > billing_email > billing location > default location > none', async () => {
      await resetSharedState();
      const { resolveInvoiceBillingRecipient } = await import('@alga-psa/billing/services');
      const contactEmail = `contact-${uuidv4().slice(0, 8)}@acme.test`;
      const billingEmail = `billing-${uuidv4().slice(0, 8)}@acme.test`;
      const billingLocationEmail = `bloc-${uuidv4().slice(0, 8)}@acme.test`;
      const defaultLocationEmail = `dloc-${uuidv4().slice(0, 8)}@acme.test`;

      // 1. Billing contact with a valid email wins.
      let clientId = uuidv4();
      await seedClientWithBillingContact(db, tenantId, clientId, contactEmail);
      await tenantTable(db, tenantId, 'clients').where({ client_id: clientId }).update({ billing_email: billingEmail });
      let resolved = await resolveInvoiceBillingRecipient({ knexOrTrx: db, tenantId, clientId });
      expect(resolved.recipientSource).toBe('billing_contact');
      expect(resolved.recipientEmail).toBe(contactEmail);
      expect(resolved.recipientName).toBe('Jane Billing');

      // 2. A contact row with a blank email never blocks clients.billing_email.
      clientId = uuidv4();
      await seedClientWithBillingContact(db, tenantId, clientId, '   ');
      await tenantTable(db, tenantId, 'clients').where({ client_id: clientId }).update({ billing_email: billingEmail });
      resolved = await resolveInvoiceBillingRecipient({ knexOrTrx: db, tenantId, clientId });
      expect(resolved.recipientSource).toBe('billing_email');
      expect(resolved.recipientEmail).toBe(billingEmail);

      // 3. No billing email: the active billing location email wins.
      clientId = uuidv4();
      await seedClientRow(db, tenantId, clientId, 'Location Precedence');
      await tenantTable(db, tenantId, 'client_locations').where({ client_id: clientId }).update({
        email: billingLocationEmail,
        is_billing_address: true,
        is_default: false,
      });
      resolved = await resolveInvoiceBillingRecipient({ knexOrTrx: db, tenantId, clientId });
      expect(resolved.recipientSource).toBe('billing_location');
      expect(resolved.recipientEmail).toBe(billingLocationEmail);

      // 4. No billing-location email: the active default location email wins.
      clientId = uuidv4();
      await seedClientRow(db, tenantId, clientId, 'Default Location');
      await tenantTable(db, tenantId, 'client_locations').where({ client_id: clientId }).update({
        email: defaultLocationEmail,
        is_billing_address: false,
        is_default: true,
      });
      resolved = await resolveInvoiceBillingRecipient({ knexOrTrx: db, tenantId, clientId });
      expect(resolved.recipientSource).toBe('default_location');
      expect(resolved.recipientEmail).toBe(defaultLocationEmail);

      // 5. Nothing valid anywhere yields an explicit no-recipient result.
      clientId = uuidv4();
      await seedClientRow(db, tenantId, clientId, 'No Recipient');
      await tenantTable(db, tenantId, 'client_locations').where({ client_id: clientId }).update({
        email: '',
        is_active: false,
      });
      resolved = await resolveInvoiceBillingRecipient({ knexOrTrx: db, tenantId, clientId });
      expect(resolved.recipientSource).toBe('none');
      expect(resolved.recipientEmail).toBe('');
    }, HOOK_TIMEOUT);

    it('never reads across tenants: an identical second tenant resolves its own data', async () => {
      await resetSharedState();
      const { resolveInvoiceBillingRecipient } = await import('@alga-psa/billing/services');
      const otherTenantId = uuidv4();
      await tenantRows(db).insert({
        tenant: otherTenantId,
        client_name: 'Second Tenant',
        email: 'second@test.co',
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      });

      const contactEmail = `iso-${uuidv4().slice(0, 8)}@acme.test`;
      const clientId = uuidv4();
      await seedClientWithBillingContact(db, otherTenantId, clientId, contactEmail);

      const resolved = await resolveInvoiceBillingRecipient({ knexOrTrx: db, tenantId: otherTenantId, clientId });
      expect(resolved.recipientSource).toBe('billing_contact');
      expect(resolved.recipientEmail).toBe(contactEmail);

      // The same client id in the primary tenant has no data, so a cross-tenant
      // read would fail; resolution from the primary tenant returns 'none'.
      const primary = await resolveInvoiceBillingRecipient({ knexOrTrx: db, tenantId, clientId });
      expect(primary.recipientSource).toBe('none');
      expect(primary.recipientEmail).toBe('');
    }, HOOK_TIMEOUT);
  });

  async function emulatorState(view: string): Promise<any[]> {
    const response = await fetch(`${stripeControlUrl}/control/stripe/state/${view}`);
    const body = await response.json();
    return body.result ?? [];
  }

  async function controlPost(path: string, body: unknown): Promise<void> {
    const response = await fetch(`${stripeControlUrl}/control/stripe/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(response.ok, `control ${path}: ${response.status}`).toBe(true);
  }

  /**
   * The server vitest suite shuffles test order, so every test starts from a
   * clean emulator (sessions/customers/faults) and an empty capture queue.
   */
  async function resetSharedState(): Promise<void> {
    await controlPost('reset', {});
    capturedEmails.length = 0;
    loggerError.mockClear();
  }
});

async function upsertProviderConfig(db: Knex, tenantId: string): Promise<void> {
  await tenantTable(db, tenantId, 'payment_provider_configs')
    .insert({
      config_id: uuidv4(),
      tenant: tenantId,
      provider_type: 'stripe',
      is_enabled: true,
      is_default: true,
      configuration: JSON.stringify({ publishable_key: 'pk_test_algasim' }),
      credentials_vault_path: 'secrets/stripe',
      settings: JSON.stringify({
        paymentLinkExpirationHours: 24,
        paymentLinksInEmails: true,
        sendPaymentConfirmations: true,
      }),
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .onConflict(['tenant', 'provider_type'])
    .merge(['configuration', 'credentials_vault_path', 'settings', 'updated_at']);
}

async function seedClientRow(
  db: Knex,
  tenantId: string,
  clientId: string,
  clientName: string
): Promise<void> {
  const uniqueName = `${clientName} ${clientId.slice(0, 8)}`;
  await tenantTable(db, tenantId, 'clients').insert({
    client_id: clientId,
    tenant: tenantId,
    client_name: uniqueName,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  await tenantTable(db, tenantId, 'client_locations').insert({
    location_id: uuidv4(),
    tenant: tenantId,
    client_id: clientId,
    location_name: 'Billing',
    address_line1: '1 Billing Way',
    city: 'Testville',
    country_code: 'US',
    country_name: 'United States',
    is_billing_address: true,
    is_default: true,
    is_active: true,
    email: `location-${uuidv4().slice(0, 8)}@acme.test`,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
}

async function seedClientWithBillingContact(
  db: Knex,
  tenantId: string,
  clientId: string,
  contactEmail: string
): Promise<void> {
  await seedClientRow(db, tenantId, clientId, 'Acme Corporation');
  const contactId = uuidv4();
  await tenantTable(db, tenantId, 'contacts').insert({
    contact_name_id: contactId,
    tenant: tenantId,
    full_name: 'Jane Billing',
    email: contactEmail,
    client_id: clientId,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  await tenantTable(db, tenantId, 'clients')
    .where({ client_id: clientId })
    .update({ billing_contact_id: contactId });
}

async function seedClientLocation(
  db: Knex,
  tenantId: string,
  clientId: string,
  input: {
    locationId: string;
    email: string;
    isBilling: boolean;
    isDefault: boolean;
    createdAt: Date;
  }
): Promise<void> {
  await tenantTable(db, tenantId, 'client_locations').insert({
    location_id: input.locationId,
    tenant: tenantId,
    client_id: clientId,
    location_name: `Location ${input.locationId.slice(-4)}`,
    address_line1: '1 Billing Way',
    city: 'Testville',
    country_code: 'US',
    country_name: 'United States',
    is_billing_address: input.isBilling,
    is_default: input.isDefault,
    is_active: true,
    email: input.email,
    created_at: input.createdAt,
    updated_at: input.createdAt,
  });
}

async function seedFinalizedInvoice(
  db: Knex,
  tenantId: string,
  clientId: string,
  invoiceId: string,
  totalAmountCents: number
): Promise<void> {
  await tenantTable(db, tenantId, 'invoices').insert({
    invoice_id: invoiceId,
    tenant: tenantId,
    client_id: clientId,
    invoice_number: `INV-${invoiceId.slice(0, 8).toUpperCase()}`,
    total_amount: totalAmountCents,
    credit_applied: 0,
    currency_code: 'USD',
    status: 'sent',
    invoice_type: 'invoice',
    invoice_date: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    due_date: new Date(Date.now() + 25 * 24 * 60 * 60 * 1000).toISOString(),
    finalized_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
}

/**
 * Bootstraps a disposable database through ONE Knex migrator over the combined
 * CE + EE migration chains (as the admin role), then seeds it. Mirrors the
 * payment-integration suite's bootstrap, which the full combined chain relies
 * on for cross-chain table ordering (e.g. EE chat tables created before the EE
 * chat-index migration runs).
 */
async function bootstrapJourneyDb(): Promise<Knex> {
  const databaseName = 'invoice_payment_links_test';
  const dbHost = process.env.DB_HOST || 'localhost';
  const dbPort = parseInt(process.env.DB_PORT || '5432', 10);
  const adminUser = process.env.DB_USER_ADMIN || 'postgres';
  const adminPassword = await getSecret('postgres_password', 'DB_PASSWORD_ADMIN', 'postpass123');
  const appUser = process.env.DB_USER_SERVER || 'app_user';
  const appPassword = await getSecret('db_password_server', 'DB_PASSWORD_SERVER', 'postpass123');

  const repoRoot = path.resolve(__dirname, '../../../../..');

  const adminConnection = knex({
    client: 'pg',
    connection: {
      host: dbHost,
      port: dbPort,
      user: adminUser,
      password: adminPassword,
      database: 'postgres',
    },
  });

  try {
    await adminConnection.raw(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ? AND pid <> pg_backend_pid()',
      [databaseName]
    );
    await adminConnection.raw(`DROP DATABASE IF EXISTS "${databaseName}"`);
    await adminConnection.raw(`CREATE DATABASE "${databaseName}"`);
    await adminConnection.raw(`DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${appUser}') THEN
          CREATE ROLE ${appUser} WITH LOGIN PASSWORD '${appPassword}';
        ELSE
          ALTER ROLE ${appUser} WITH LOGIN PASSWORD '${appPassword}';
        END IF;
      END;
    $$;`);
    await adminConnection.raw(`ALTER DATABASE "${databaseName}" OWNER TO ${appUser}`);
    await adminConnection.raw(`GRANT ALL PRIVILEGES ON DATABASE "${databaseName}" TO ${appUser}`);
    if (adminUser !== appUser) {
      await adminConnection.raw(`GRANT ${adminUser} TO ${appUser}`);
    }
  } finally {
    await adminConnection.destroy().catch(() => undefined);
  }

  const db = knex({
    client: 'pg',
    connection: {
      host: dbHost,
      port: dbPort,
      user: adminUser,
      password: adminPassword,
      database: databaseName,
    },
    migrations: {
      directory: path.join(repoRoot, 'server', 'migrations'),
    },
    seeds: {
      directory: path.join(repoRoot, 'server', 'seeds', 'dev'),
    },
  });

  await db.raw('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');
  await db.raw('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
  // Citus-distribution probes run inside dozens of migrations; on plain
  // Postgres each one errors server-side before its try/catch concludes "not
  // Citus". An empty stand-in catalog makes every probe succeed.
  await db.raw('CREATE TABLE IF NOT EXISTS public.pg_dist_partition (logicalrelid regclass)');

  await db.migrate.latest({
    directory: [
      path.join(repoRoot, 'server', 'migrations'),
      path.join(repoRoot, 'ee', 'server', 'migrations'),
    ],
    loadExtensions: ['.cjs', '.js'],
  });
  await db.seed.run({
    directory: path.join(repoRoot, 'server', 'seeds', 'dev'),
    loadExtensions: ['.cjs', '.js'],
  });

  const safeAppUser = appUser.replace(/[^a-zA-Z0-9_]/g, '');
  await db.raw(`ALTER ROLE ${safeAppUser} RESET idle_in_transaction_session_timeout`);
  await db.raw(`ALTER ROLE ${safeAppUser} RESET lock_timeout`);

  return db;
}

async function ensureTenant(connection: Knex): Promise<string> {  const existing = await tenantRows(connection).first<{ tenant: string }>('tenant');
  if (existing?.tenant) {
    return existing.tenant;
  }

  const newTenantId = uuidv4();
  const defaultClientId = uuidv4();
  await tenantRows(connection).insert({
    tenant: newTenantId,
    client_name: 'Invoice Payment Links Tenant',
    email: 'invoice-payment-links@test.co',
    created_at: connection.fn.now(),
    updated_at: connection.fn.now(),
  });
  // fetchTenantParty resolves the MSP sender from the tenant's default company.
  await tenantTable(connection, newTenantId, 'clients').insert({
    client_id: defaultClientId,
    tenant: newTenantId,
    client_name: 'Invoice Payment Links Tenant',
    created_at: connection.fn.now(),
    updated_at: connection.fn.now(),
  });
  await tenantTable(connection, newTenantId, 'tenant_companies').insert({
    tenant: newTenantId,
    client_id: defaultClientId,
    is_default: true,
  });
  return newTenantId;
}
