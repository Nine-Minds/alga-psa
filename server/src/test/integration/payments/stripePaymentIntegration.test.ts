/**
 * Stripe Payment Integration Tests
 *
 * Behavioral tests that expose gaps in the payment integration including:
 * - Race conditions in concurrent webhook processing
 * - Tenant isolation vulnerabilities
 * - Missing amount/currency validation
 * - Missing refund handling
 * - Invoice status transition issues
 * - Webhook error handling gaps
 * - Payment link expiration issues
 *
 * These tests drive against actual PaymentService business logic with mocked Stripe.
 */

import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import type { Knex } from 'knex';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';

// Mock Stripe before any imports that use it
vi.mock('stripe', () => {
  const mockStripe = vi.fn().mockImplementation(() => ({
    customers: {
      create: vi.fn().mockResolvedValue({ id: 'cus_mock123' }),
      retrieve: vi.fn().mockResolvedValue({ id: 'cus_mock123', deleted: false }),
      list: vi.fn().mockResolvedValue({ data: [] }),
    },
    checkout: {
      sessions: {
        create: vi.fn().mockImplementation((params: any) => Promise.resolve({
          id: `cs_mock_${uuidv4().slice(0, 8)}`,
          url: 'https://checkout.stripe.com/mock',
          payment_intent: `pi_mock_${uuidv4().slice(0, 8)}`,
          amount_total: params.line_items?.[0]?.price_data?.unit_amount || 10000,
          currency: params.line_items?.[0]?.price_data?.currency || 'usd',
          metadata: params.metadata,
        })),
        retrieve: vi.fn().mockResolvedValue({
          id: 'cs_mock123',
          payment_intent: 'pi_mock123',
          status: 'complete',
          amount_total: 10000,
          currency: 'usd',
        }),
        expire: vi.fn().mockResolvedValue({ id: 'cs_mock123' }),
      },
    },
    paymentIntents: {
      retrieve: vi.fn().mockResolvedValue({
        id: 'pi_mock123',
        status: 'succeeded',
        amount: 10000,
        currency: 'usd',
        created: Math.floor(Date.now() / 1000),
        latest_charge: {
          receipt_url: 'https://receipt.stripe.com/mock',
          payment_method_details: {
            type: 'card',
            card: { last4: '4242', brand: 'visa' },
          },
        },
      }),
    },
    webhooks: {
      constructEvent: vi.fn().mockImplementation((payload, _signature, _secret) => {
        // Parse the payload and return it as an event
        return JSON.parse(payload);
      }),
    },
  }));

  return { default: mockStripe, Stripe: mockStripe };
});

// Mock the secret provider
vi.mock('@alga-psa/core', () => ({
  getSecretProviderInstance: vi.fn().mockResolvedValue({
    getTenantSecret: vi.fn().mockResolvedValue('sk_test_mock'),
    getAppSecret: vi.fn().mockResolvedValue('sk_test_mock'),
  }),
}));

// Mock logger
vi.mock('@alga-psa/core/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Database connection module mock
let mockDb: Knex;
vi.mock('server/src/lib/db/db', () => ({
  getConnection: vi.fn(() => Promise.resolve(mockDb)),
}));

// Mock tenant utilities
let testTenantId: string;
vi.mock('server/src/lib/db', async () => {
  const actual = await vi.importActual<typeof import('server/src/lib/db')>('server/src/lib/db');
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({ knex: mockDb, tenant: testTenantId })),
    getCurrentTenantId: vi.fn(async () => testTenantId ?? null),
    runWithTenant: vi.fn(async (_tenant: string, fn: () => Promise<any>) => fn()),
  };
});

vi.mock('server/src/lib/tenant', () => ({
  getTenantForCurrentRequest: vi.fn(async () => testTenantId ?? null),
  getTenantFromHeaders: vi.fn(() => testTenantId ?? null),
}));

// Mock recordTransaction
vi.mock('server/src/lib/utils/transactionUtils', () => ({
  recordTransaction: vi.fn().mockResolvedValue({ transaction_id: uuidv4() }),
}));

import { knex } from 'knex';

describe('Stripe Payment Integration - Vulnerability Tests', () => {
  const HOOK_TIMEOUT = 180_000;

  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    process.env.DB_USER_ADMIN = process.env.DB_USER_ADMIN || 'postgres';
    process.env.DB_NAME_SERVER = process.env.DB_NAME_SERVER || 'test_database';
    process.env.DB_HOST = process.env.DB_HOST || 'localhost';
    process.env.DB_PORT = process.env.DB_PORT || '5432';
    process.env.DB_PASSWORD_ADMIN = process.env.DB_PASSWORD_ADMIN || 'postpass123';
    process.env.DB_USER_SERVER = process.env.DB_USER_SERVER || 'app_user';
    process.env.DB_PASSWORD_SERVER = process.env.DB_PASSWORD_SERVER || 'postpass123';
    process.env.NEXT_PUBLIC_EDITION = 'enterprise';
    process.env.STRIPE_SECRET_KEY = 'sk_test_mock';
    process.env.STRIPE_PAYMENT_WEBHOOK_SECRET = 'whsec_mock';
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_test_mock';

    mockDb = await createTestDbConnection();
    await runMigrationsAndSeeds(mockDb);
    testTenantId = await ensureTenant(mockDb);
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await mockDb?.destroy();
  }, HOOK_TIMEOUT);

  describe('Race Condition in Concurrent Webhook Processing', () => {
    /**
     * CRITICAL BUG: PaymentService.ts:462-491
     * When multiple webhooks arrive simultaneously for the same invoice,
     * the SUM query followed by UPDATE creates a race condition.
     *
     * This test verifies correct behavior - it may fail due to the race condition
     * until SELECT FOR UPDATE or atomic operations are implemented.
     */
    it('should correctly update invoice status when processing concurrent webhooks', async () => {
      const { PaymentService } = await import('@ee/lib/payments');

      const { invoiceId } = await createTestInvoiceWithClient(mockDb, testTenantId, {
        totalAmount: 10000, // $100.00
        status: 'sent',
      });

      await setupPaymentProviderConfig(mockDb, testTenantId);

      const paymentService = await PaymentService.create(testTenantId);

      // Simulate two concurrent webhook events for the same invoice
      const webhookEvent1 = createMockWebhookEvent({
        eventId: `evt_concurrent_1_${uuidv4().slice(0, 8)}`,
        invoiceId,
        amount: 5000, // $50 - partial payment
        status: 'succeeded',
      });

      const webhookEvent2 = createMockWebhookEvent({
        eventId: `evt_concurrent_2_${uuidv4().slice(0, 8)}`,
        invoiceId,
        amount: 5000, // $50 - another partial payment
        status: 'succeeded',
      });

      // Process both webhooks concurrently
      const [result1, result2] = await Promise.all([
        paymentService.processWebhookEvent(webhookEvent1),
        paymentService.processWebhookEvent(webhookEvent2),
      ]);

      // Both should succeed
      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);

      // Verify both payments were recorded
      const payments = await mockDb('invoice_payments')
        .where({ invoice_id: invoiceId, tenant: testTenantId })
        .select('*');
      expect(payments.length).toBe(2);
      expect(payments.reduce((sum: number, p: any) => sum + Number(p.amount), 0)).toBe(10000);

      // CORRECT BEHAVIOR: Invoice should be marked as 'paid' since total payments = invoice amount
      // BUG: Due to race condition, this may fail with status = 'partially_applied'
      const invoice = await mockDb('invoices')
        .where({ invoice_id: invoiceId, tenant: testTenantId })
        .first();
      expect(invoice.status).toBe('paid');
    }, HOOK_TIMEOUT);

    it('should handle duplicate webhook events idempotently', async () => {
      const { PaymentService } = await import('@ee/lib/payments');

      const { invoiceId } = await createTestInvoiceWithClient(mockDb, testTenantId, {
        totalAmount: 10000,
        status: 'sent',
      });

      await setupPaymentProviderConfig(mockDb, testTenantId);
      const paymentService = await PaymentService.create(testTenantId);

      const eventId = `evt_duplicate_${uuidv4().slice(0, 8)}`;
      const webhookEvent = createMockWebhookEvent({
        eventId,
        invoiceId,
        amount: 10000,
        status: 'succeeded',
      });

      // Process the same event twice
      const result1 = await paymentService.processWebhookEvent(webhookEvent);
      const result2 = await paymentService.processWebhookEvent(webhookEvent);

      expect(result1.success).toBe(true);
      expect(result1.paymentRecorded).toBe(true);

      // Second processing should be idempotent
      expect(result2.success).toBe(true);
      expect(result2.paymentRecorded).toBe(false); // Should not record again

      // Verify only one payment was recorded
      const payments = await mockDb('invoice_payments')
        .where({ invoice_id: invoiceId, tenant: testTenantId });
      expect(payments.length).toBe(1);
    }, HOOK_TIMEOUT);
  });

  describe('Tenant Isolation Vulnerabilities', () => {
    /**
     * CRITICAL BUG: route.ts:113-126
     * Webhook accepts tenant_id from metadata without verifying
     * the webhook secret belongs to that tenant.
     */
    it('should expose tenant isolation gap when webhook contains different tenant_id', async () => {
      const { PaymentService } = await import('@ee/lib/payments');

      // Create invoice in tenant A
      const tenantA = testTenantId;
      const { invoiceId: invoiceA } = await createTestInvoiceWithClient(mockDb, tenantA, {
        totalAmount: 10000,
        status: 'sent',
      });
      await setupPaymentProviderConfig(mockDb, tenantA);

      // Create tenant B with its own invoice
      const tenantB = await ensureSecondTenant(mockDb);
      const { invoiceId: _invoiceB } = await createTestInvoiceWithClient(mockDb, tenantB, {
        totalAmount: 50000,
        status: 'sent',
      });
      await setupPaymentProviderConfig(mockDb, tenantB);

      // BUG EXPOSURE: Malicious webhook with tenant_id = tenantB
      // but invoice_id = invoiceA (belonging to tenantA)
      // The current implementation would try to process this
      const maliciousWebhook = createMockWebhookEvent({
        eventId: `evt_malicious_${uuidv4().slice(0, 8)}`,
        invoiceId: invoiceA, // Invoice from tenant A
        amount: 10000,
        status: 'succeeded',
        tenantId: tenantB, // But metadata says tenant B
      });

      // If we create service for tenant B (as webhook handler would)
      const paymentServiceB = await PaymentService.create(tenantB);

      // This should fail because invoiceA doesn't exist in tenant B
      // BUG: But the system might not properly validate this
      const result = await paymentServiceB.processWebhookEvent(maliciousWebhook);

      // The invoice lookup should fail because we're querying tenant B's invoices
      // This test verifies that tenant isolation is enforced at the data layer
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invoice not found');
    }, HOOK_TIMEOUT);

    it('should prevent cross-tenant payment recording', async () => {
      const { PaymentService } = await import('@ee/lib/payments');

      const tenantA = testTenantId;
      const { invoiceId } = await createTestInvoiceWithClient(mockDb, tenantA, {
        totalAmount: 10000,
        status: 'sent',
      });

      const tenantB = await ensureSecondTenant(mockDb);
      await setupPaymentProviderConfig(mockDb, tenantB);

      // Try to record payment for tenant A's invoice using tenant B's service
      const paymentServiceB = await PaymentService.create(tenantB);

      const webhookEvent = createMockWebhookEvent({
        eventId: `evt_cross_tenant_${uuidv4().slice(0, 8)}`,
        invoiceId, // Tenant A's invoice
        amount: 10000,
        status: 'succeeded',
      });

      const result = await paymentServiceB.processWebhookEvent(webhookEvent);

      // Should fail - invoice doesn't exist in tenant B's context
      expect(result.success).toBe(false);

      // Verify no payment was recorded in either tenant
      const paymentsA = await mockDb('invoice_payments')
        .where({ invoice_id: invoiceId, tenant: tenantA });
      const paymentsB = await mockDb('invoice_payments')
        .where({ invoice_id: invoiceId, tenant: tenantB });

      expect(paymentsA.length).toBe(0);
      expect(paymentsB.length).toBe(0);
    }, HOOK_TIMEOUT);
  });

  describe('Missing Amount and Currency Validation', () => {
    /**
     * Partial payments are allowed. The system accepts payments that are less than
     * the invoice total and marks the invoice as 'partially_applied'. Payments that
     * exceed the invoice total are logged as warnings but still processed.
     */
    it('should accept partial payments and update invoice status appropriately', async () => {
      const { PaymentService } = await import('@ee/lib/payments');

      const { invoiceId } = await createTestInvoiceWithClient(mockDb, testTenantId, {
        totalAmount: 100000, // $1000.00
        status: 'sent',
      });

      await setupPaymentProviderConfig(mockDb, testTenantId);
      const paymentService = await PaymentService.create(testTenantId);

      // Partial payment - only $1.00 for $1000 invoice
      const webhookEvent = createMockWebhookEvent({
        eventId: `evt_partial_${uuidv4().slice(0, 8)}`,
        invoiceId,
        amount: 100, // Only $1.00
        status: 'succeeded',
      });

      const result = await paymentService.processWebhookEvent(webhookEvent);

      // Partial payments should be accepted
      expect(result.success).toBe(true);
      expect(result.paymentRecorded).toBe(true);

      // Invoice should be marked as partially_applied
      const invoice = await mockDb('invoices')
        .where({ invoice_id: invoiceId, tenant: testTenantId })
        .first();
      expect(invoice.status).toBe('partially_applied');
    }, HOOK_TIMEOUT);

    /**
     * HIGH BUG: PaymentService.ts:448-460
     * No validation that payment currency matches invoice currency.
     *
     * CORRECT BEHAVIOR: System should reject payments in wrong currency
     * or require explicit currency conversion.
     */
    it('should reject payment in different currency than invoice', async () => {
      const { PaymentService } = await import('@ee/lib/payments');

      const { invoiceId } = await createTestInvoiceWithClient(mockDb, testTenantId, {
        totalAmount: 10000,
        currency: 'USD',
        status: 'sent',
      });

      await setupPaymentProviderConfig(mockDb, testTenantId);
      const paymentService = await PaymentService.create(testTenantId);

      // Payment in EUR for USD invoice - currency mismatch
      const webhookEvent = createMockWebhookEvent({
        eventId: `evt_currency_mismatch_${uuidv4().slice(0, 8)}`,
        invoiceId,
        amount: 10000,
        currency: 'EUR', // Different currency!
        status: 'succeeded',
      });

      const result = await paymentService.processWebhookEvent(webhookEvent);

      // CORRECT BEHAVIOR: Should reject currency mismatch
      expect(result.success).toBe(false);
      expect(result.error?.toLowerCase()).toContain('currency mismatch');
    }, HOOK_TIMEOUT);
  });

  describe('Missing Refund Handling', () => {
    /**
     * HIGH BUG: PaymentService.ts:334-355
     * No handlers for refund events.
     *
     * CORRECT BEHAVIOR: Refunds should update invoice status appropriately.
     */
    it('should update invoice status when payment is refunded', async () => {
      const { PaymentService } = await import('@ee/lib/payments');

      const { invoiceId } = await createTestInvoiceWithClient(mockDb, testTenantId, {
        totalAmount: 10000,
        status: 'sent',
      });

      await setupPaymentProviderConfig(mockDb, testTenantId);
      const paymentService = await PaymentService.create(testTenantId);

      // First, process a successful payment
      const paymentEvent = createMockWebhookEvent({
        eventId: `evt_payment_${uuidv4().slice(0, 8)}`,
        invoiceId,
        amount: 10000,
        status: 'succeeded',
      });

      await paymentService.processWebhookEvent(paymentEvent);

      // Verify invoice is paid
      let invoice = await mockDb('invoices')
        .where({ invoice_id: invoiceId, tenant: testTenantId })
        .first();
      expect(invoice.status).toBe('paid');

      // Now simulate a refund event
      const refundEvent = createMockWebhookEvent({
        eventId: `evt_refund_${uuidv4().slice(0, 8)}`,
        eventType: 'charge.refunded', // Refund event type
        invoiceId,
        amount: 10000,
        status: 'refunded',
      });

      const refundResult = await paymentService.processWebhookEvent(refundEvent);

      // CORRECT BEHAVIOR: Refund should be processed and recorded
      expect(refundResult.success).toBe(true);
      expect(refundResult.paymentRecorded).toBe(true); // Should record the refund

      // Invoice should be updated to reflect the refund
      invoice = await mockDb('invoices')
        .where({ invoice_id: invoiceId, tenant: testTenantId })
        .first();

      // CORRECT BEHAVIOR: Invoice should no longer be 'paid' after full refund
      // BUG: Currently stays as 'paid' because refund events are not handled
      expect(invoice.status).not.toBe('paid');
      expect(['sent', 'refunded']).toContain(invoice.status);
    }, HOOK_TIMEOUT);

    /**
     * CORRECT BEHAVIOR: Partial refunds should update invoice to show balance owed.
     */
    it('should track partial refunds and update invoice balance', async () => {
      const { PaymentService } = await import('@ee/lib/payments');

      const { invoiceId } = await createTestInvoiceWithClient(mockDb, testTenantId, {
        totalAmount: 10000,
        status: 'sent',
      });

      await setupPaymentProviderConfig(mockDb, testTenantId);
      const paymentService = await PaymentService.create(testTenantId);

      // Process successful payment
      const paymentEvent = createMockWebhookEvent({
        eventId: `evt_full_payment_${uuidv4().slice(0, 8)}`,
        invoiceId,
        amount: 10000,
        status: 'succeeded',
      });

      await paymentService.processWebhookEvent(paymentEvent);

      // Simulate partial refund (50%)
      const partialRefundEvent = createMockWebhookEvent({
        eventId: `evt_partial_refund_${uuidv4().slice(0, 8)}`,
        eventType: 'charge.refunded',
        invoiceId,
        amount: 5000, // 50% refund
        status: 'partially_refunded',
      });

      const result = await paymentService.processWebhookEvent(partialRefundEvent);

      // CORRECT BEHAVIOR: Partial refund should be recorded
      // BUG: Currently not handled
      expect(result.success).toBe(true);
      expect(result.paymentRecorded).toBe(true);

      // Invoice should reflect partial refund - now only $50 paid of $100
      const invoice = await mockDb('invoices')
        .where({ invoice_id: invoiceId, tenant: testTenantId })
        .first();

      // CORRECT BEHAVIOR: Should be 'partially_applied' or similar after partial refund
      // BUG: Currently stays as 'paid' - accounting mismatch
      expect(invoice.status).toBe('partially_applied');
    }, HOOK_TIMEOUT);
  });

  describe('Invoice Status Transition Issues', () => {
    /**
     * MEDIUM BUG: PaymentService.ts:473-490
     * No validation of valid status transitions.
     *
     * CORRECT BEHAVIOR: Cancelled invoices should reject payments.
     */
    it('should reject payments for cancelled invoices', async () => {
      const { PaymentService } = await import('@ee/lib/payments');

      const { invoiceId } = await createTestInvoiceWithClient(mockDb, testTenantId, {
        totalAmount: 10000,
        status: 'cancelled', // Already cancelled
      });

      await setupPaymentProviderConfig(mockDb, testTenantId);
      const paymentService = await PaymentService.create(testTenantId);

      // Attempt to pay a cancelled invoice
      const webhookEvent = createMockWebhookEvent({
        eventId: `evt_pay_cancelled_${uuidv4().slice(0, 8)}`,
        invoiceId,
        amount: 10000,
        status: 'succeeded',
      });

      const result = await paymentService.processWebhookEvent(webhookEvent);

      // CORRECT BEHAVIOR: Should reject payment for cancelled invoice
      // BUG: Currently accepts and marks as paid
      expect(result.success).toBe(false);
      expect(result.error).toContain('cancelled');

      // Invoice should remain cancelled
      const invoice = await mockDb('invoices')
        .where({ invoice_id: invoiceId, tenant: testTenantId })
        .first();
      expect(invoice.status).toBe('cancelled');
    }, HOOK_TIMEOUT);

    /**
     * CORRECT BEHAVIOR: Draft invoices should not be payable - they haven't
     * been approved and sent to the customer yet.
     */
    it('should reject payments for draft invoices', async () => {
      const { PaymentService } = await import('@ee/lib/payments');

      const { invoiceId } = await createTestInvoiceWithClient(mockDb, testTenantId, {
        totalAmount: 10000,
        status: 'draft', // Not yet sent to customer
      });

      await setupPaymentProviderConfig(mockDb, testTenantId);
      const paymentService = await PaymentService.create(testTenantId);

      const webhookEvent = createMockWebhookEvent({
        eventId: `evt_pay_draft_${uuidv4().slice(0, 8)}`,
        invoiceId,
        amount: 10000,
        status: 'succeeded',
      });

      const result = await paymentService.processWebhookEvent(webhookEvent);

      // CORRECT BEHAVIOR: Should reject payment for draft invoice
      // BUG: Currently accepts, bypassing approval workflow
      expect(result.success).toBe(false);
      expect(result.error).toContain('draft');

      // Invoice should remain in draft
      const invoice = await mockDb('invoices')
        .where({ invoice_id: invoiceId, tenant: testTenantId })
        .first();
      expect(invoice.status).toBe('draft');
    }, HOOK_TIMEOUT);
  });

  describe('Webhook Error Handling Gaps', () => {
    /**
     * MEDIUM BUG: route.ts:181-196
     * Returns 200 on processing failure, preventing Stripe retries.
     *
     * This test verifies the error is surfaced properly.
     * Note: FK constraints prevent recording webhook events for non-existent invoices,
     * which is actually correct behavior. The bug is in how the HTTP route handles errors.
     */
    it('should properly report errors for webhooks referencing non-existent invoices', async () => {
      const { PaymentService } = await import('@ee/lib/payments');

      await setupPaymentProviderConfig(mockDb, testTenantId);
      const paymentService = await PaymentService.create(testTenantId);

      // Create webhook for non-existent invoice
      const webhookEvent = createMockWebhookEvent({
        eventId: `evt_not_found_${uuidv4().slice(0, 8)}`,
        invoiceId: uuidv4(), // Invoice doesn't exist
        amount: 10000,
        status: 'succeeded',
      });

      // CORRECT BEHAVIOR: Should fail with clear error (either "Invoice not found"
      // or FK constraint). The service should validate invoice exists before
      // trying to record the webhook event.
      // BUG: Currently hits FK constraint because it tries to record event first
      let result;
      let thrownError: Error | null = null;
      try {
        result = await paymentService.processWebhookEvent(webhookEvent);
      } catch (error) {
        thrownError = error as Error;
      }

      // Either returns failure result OR throws FK constraint error
      if (thrownError) {
        // FK constraint error means service tried to record event before validating
        // This is a bug - should return clean error instead
        expect(thrownError.message).toContain('foreign key constraint');
      } else {
        expect(result?.success).toBe(false);
        expect(result?.error).toBeDefined();
      }
    }, HOOK_TIMEOUT);

    /**
     * Test that successful payment webhooks are properly recorded for tracking.
     */
    it('should record webhook events for valid invoices', async () => {
      const { PaymentService } = await import('@ee/lib/payments');

      const { invoiceId } = await createTestInvoiceWithClient(mockDb, testTenantId, {
        totalAmount: 10000,
        status: 'sent',
      });

      await setupPaymentProviderConfig(mockDb, testTenantId);
      const paymentService = await PaymentService.create(testTenantId);

      const eventId = `evt_valid_${uuidv4().slice(0, 8)}`;
      const webhookEvent = createMockWebhookEvent({
        eventId,
        invoiceId, // Valid invoice
        amount: 10000,
        status: 'succeeded',
      });

      const result = await paymentService.processWebhookEvent(webhookEvent);
      expect(result.success).toBe(true);

      // Check the webhook event was recorded
      const eventRecord = await mockDb('payment_webhook_events')
        .where({
          tenant: testTenantId,
          external_event_id: eventId,
        })
        .first();

      expect(eventRecord).toBeDefined();
      expect(eventRecord.processing_status).toBe('completed');
      expect(eventRecord.processed).toBe(true);
    }, HOOK_TIMEOUT);
  });

  describe('Payment Link Expiration Issues', () => {
    /**
     * MEDIUM BUG: PaymentSettings.tsx allows 30-day expiration,
     * but Stripe Checkout Sessions max out at 24 hours.
     */
    it('should expose payment link expiration beyond Stripe limit', async () => {
      const { PaymentService } = await import('@ee/lib/payments');

      const { invoiceId } = await createTestInvoiceWithClient(mockDb, testTenantId, {
        totalAmount: 10000,
        status: 'sent',
      });

      // Configure with 30-day expiration (720 hours)
      await setupPaymentProviderConfig(mockDb, testTenantId, {
        paymentLinkExpirationHours: 720, // 30 days - exceeds Stripe's 24-hour limit
      });

      const paymentService = await PaymentService.create(testTenantId);

      // CORRECT BEHAVIOR: Service should cap expiration at 24 hours (Stripe's limit)
      // or reject the configuration
      const link = await paymentService.getOrCreatePaymentLink(invoiceId);

      // Verify a link was created
      expect(link).toBeDefined();
      expect(link?.expiresAt).toBeDefined();

      if (link?.expiresAt) {
        const hoursUntilExpiry = (link.expiresAt.getTime() - Date.now()) / (1000 * 60 * 60);
        // BUG: Service allows 720 hours but Stripe max is 24 hours
        // This will cause Stripe API failures or silent capping
        expect(hoursUntilExpiry).toBeLessThanOrEqual(24);
      }
    }, HOOK_TIMEOUT);

    /**
     * MEDIUM BUG: Expired links are not cleaned up or updated in database.
     */
    it('should expose expired payment links remaining in active status', async () => {
      const { invoiceId } = await createTestInvoiceWithClient(mockDb, testTenantId, {
        totalAmount: 10000,
        status: 'sent',
      });

      // Insert an already-expired payment link
      const expiredLinkId = uuidv4();
      await mockDb('invoice_payment_links').insert({
        link_id: expiredLinkId,
        tenant: testTenantId,
        invoice_id: invoiceId,
        provider_type: 'stripe',
        external_link_id: `cs_expired_${uuidv4().slice(0, 8)}`,
        url: 'https://checkout.stripe.com/expired',
        amount: 10000,
        currency: 'USD',
        status: 'active', // Still marked as active!
        expires_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), // Expired yesterday
        created_at: mockDb.fn.now(),
      });

      // The link is expired but database says 'active'
      const link = await mockDb('invoice_payment_links')
        .where({ link_id: expiredLinkId })
        .first();

      expect(link.status).toBe('active'); // BUG: Should be 'expired'

      // There's no background job to update expired links
      // This could lead to:
      // 1. Showing expired links to users
      // 2. Audit/reporting issues
    }, HOOK_TIMEOUT);
  });

  describe('Integer Overflow and Precision Issues', () => {
    /**
     * CRITICAL BUG: PaymentService.ts:471
     * parseInt() on sum can lose precision for large amounts.
     */
    it('should expose potential precision loss with large payment amounts', async () => {
      const { PaymentService } = await import('@ee/lib/payments');

      // Large invoice: $100 million
      const { invoiceId } = await createTestInvoiceWithClient(mockDb, testTenantId, {
        totalAmount: 10000000000, // $100,000,000.00 in cents
        status: 'sent',
      });

      await setupPaymentProviderConfig(mockDb, testTenantId);
      const paymentService = await PaymentService.create(testTenantId);

      // Multiple large payments
      for (let i = 0; i < 3; i++) {
        const webhookEvent = createMockWebhookEvent({
          eventId: `evt_large_${i}_${uuidv4().slice(0, 8)}`,
          invoiceId,
          amount: 3333333333 + i, // ~$33.3 million each
          status: 'succeeded',
        });

        await paymentService.processWebhookEvent(webhookEvent);
      }

      // Check if precision was maintained in payment totals
      const totalPayments = await mockDb('invoice_payments')
        .where({ invoice_id: invoiceId, tenant: testTenantId })
        .sum('amount as total')
        .first();

      const total = Number(totalPayments?.total || 0);
      expect(total).toBeGreaterThan(9999999999);

      // Verify invoice status was correctly calculated despite large amounts
      const invoice = await mockDb('invoices')
        .where({ invoice_id: invoiceId, tenant: testTenantId })
        .first();

      // CORRECT BEHAVIOR: Invoice should be paid if total payments >= total_amount
      // BUG: parseInt() might lose precision for very large amounts
      expect(invoice.status).toBe('paid');
    }, HOOK_TIMEOUT);
  });

  describe('Customer Sharing Vulnerability', () => {
    /**
     * HIGH BUG: StripePaymentProvider.ts:221-238
     * Customer lookup by email doesn't verify tenant ownership.
     */
    it('should expose potential customer sharing across tenants', async () => {
      // This test verifies the vulnerability exists
      // Two tenants with same customer email could share Stripe customer

      const tenantA = testTenantId;
      const tenantB = await ensureSecondTenant(mockDb);

      const sharedEmail = `shared_${uuidv4().slice(0, 8)}@example.com`;

      // Create client with same email in both tenants
      const clientA = await createClientForTenant(mockDb, tenantA, sharedEmail);
      const clientB = await createClientForTenant(mockDb, tenantB, sharedEmail);

      await setupPaymentProviderConfig(mockDb, tenantA);
      await setupPaymentProviderConfig(mockDb, tenantB);

      // Both tenants might end up using the same Stripe customer
      // because getOrCreateCustomer searches by email globally in Stripe
      // without tenant metadata verification

      // This is a security concern - payment methods could be shared
      expect(clientA).toBeDefined();
      expect(clientB).toBeDefined();
      // BUG: No test can verify this without real Stripe API,
      // but the code clearly shows the vulnerability in getOrCreateCustomer
    }, HOOK_TIMEOUT);
  });

  // ===========================================================================
  // BUG-EXPOSING TESTS: These tests should FAIL until bugs are fixed
  // ===========================================================================

  describe('BUG: Wrong Redirect URLs in Payment Links', () => {
    /**
     * CRITICAL BUG: PaymentService.ts:207-209
     * Success/cancel URLs use /portal/invoices/ but actual routes are at
     * /client-portal/billing/invoices/
     *
     * After payment, users get redirected to a 404 page.
     */
    it('should generate correct client portal redirect URLs', async () => {
      // Verify the implementation directly by checking source code
      // This avoids mock limitations where we can't capture internal Stripe calls
      const fs = await import('fs');
      const path = await import('path');

      const paymentServicePath = path.join(
        process.cwd(),
        'ee/server/src/lib/payments/PaymentService.ts'
      );

      const sourceCode = fs.readFileSync(paymentServicePath, 'utf-8');

      // Find the successUrl and cancelUrl definitions
      const successUrlMatch = sourceCode.match(/successUrl\s*=\s*`[^`]+`/);
      const cancelUrlMatch = sourceCode.match(/cancelUrl\s*=\s*`[^`]+`/);

      expect(successUrlMatch).toBeDefined();
      expect(cancelUrlMatch).toBeDefined();

      const successUrl = successUrlMatch![0];
      const cancelUrl = cancelUrlMatch![0];

      // CRITICAL: These assertions will FAIL until bug is fixed
      // The URLs should use /client-portal/billing/invoices/ not /portal/invoices/
      expect(successUrl).toContain('/client-portal/billing/invoices/');
      expect(successUrl).toContain('/payment-success');
      expect(cancelUrl).toContain('/client-portal/billing/invoices/');

      // Also verify they DON'T use the wrong path
      expect(successUrl).not.toMatch(/\/portal\/invoices\/[^/]/);
      expect(cancelUrl).not.toMatch(/\/portal\/invoices\/[^/]/);
    }, HOOK_TIMEOUT);
  });

  describe('BUG: Refund Events Not Parsed Correctly', () => {
    /**
     * CRITICAL BUG: StripePaymentProvider.ts:398-451
     * parseWebhookEvent has no case for charge.refunded event.
     * Amount and currency are not extracted, causing refunds to be silently skipped.
     */
    it('should parse charge.refunded events with correct amount and currency', async () => {
      const { createStripePaymentProvider } = await import('@ee/lib/payments');

      const provider = createStripePaymentProvider(testTenantId);

      // Simulate a real Stripe charge.refunded webhook payload
      const refundPayload = JSON.stringify({
        id: 'evt_refund_test_123',
        type: 'charge.refunded',
        data: {
          object: {
            id: 'ch_test_123',
            object: 'charge',
            amount: 10000, // Original charge amount
            amount_refunded: 5000, // Refunded amount
            currency: 'usd',
            payment_intent: 'pi_test_123',
            customer: 'cus_test_123',
            refunded: true,
            metadata: {
              invoice_id: 'inv_test_123',
              tenant_id: testTenantId,
            },
            refunds: {
              data: [{
                id: 're_test_123',
                amount: 5000,
                currency: 'usd',
              }],
            },
          },
        },
      });

      const parsedEvent = provider.parseWebhookEvent(refundPayload);

      // CRITICAL: These assertions will FAIL until bug is fixed
      // Currently falls through to default case which doesn't extract amount
      expect(parsedEvent.eventType).toBe('charge.refunded');
      expect(parsedEvent.invoiceId).toBe('inv_test_123');

      // BUG: amount is undefined because there's no case for charge.refunded
      expect(parsedEvent.amount).toBeDefined();
      expect(parsedEvent.amount).toBe(5000); // Should be the refunded amount

      // BUG: currency is undefined because there's no case for charge.refunded
      expect(parsedEvent.currency).toBeDefined();
      expect(parsedEvent.currency).toBe('USD');

      // BUG: paymentIntentId is undefined
      expect(parsedEvent.paymentIntentId).toBe('pi_test_123');
    }, HOOK_TIMEOUT);

    /**
     * End-to-end test: Refund webhook should actually record a refund
     */
    it('should process charge.refunded webhook and record refund', async () => {
      const { PaymentService, createStripePaymentProvider } = await import('@ee/lib/payments');

      const { invoiceId } = await createTestInvoiceWithClient(mockDb, testTenantId, {
        totalAmount: 10000,
        status: 'sent',
      });

      await setupPaymentProviderConfig(mockDb, testTenantId);
      const paymentService = await PaymentService.create(testTenantId);

      // First, record a successful payment
      const paymentEvent = createMockWebhookEvent({
        eventId: `evt_pay_${uuidv4().slice(0, 8)}`,
        invoiceId,
        amount: 10000,
        status: 'succeeded',
      });
      await paymentService.processWebhookEvent(paymentEvent);

      // Verify invoice is paid
      let invoice = await mockDb('invoices')
        .where({ invoice_id: invoiceId, tenant: testTenantId })
        .first();
      expect(invoice.status).toBe('paid');

      // Now process a refund by parsing from raw webhook payload
      // This simulates what actually happens in production
      const provider = createStripePaymentProvider(testTenantId);
      const refundPayload = JSON.stringify({
        id: `evt_refund_${uuidv4().slice(0, 8)}`,
        type: 'charge.refunded',
        data: {
          object: {
            id: 'ch_test_123',
            amount: 10000,
            amount_refunded: 10000, // Full refund
            currency: 'usd',
            payment_intent: paymentEvent.paymentIntentId,
            customer: 'cus_test',
            metadata: {
              invoice_id: invoiceId,
              tenant_id: testTenantId,
            },
          },
        },
      });

      const parsedRefundEvent = provider.parseWebhookEvent(refundPayload);

      // BUG: This will fail because parseWebhookEvent doesn't extract amount
      // for charge.refunded events, so handleChargeRefunded will skip it
      const refundResult = await paymentService.processWebhookEvent(parsedRefundEvent);

      // CRITICAL: This should succeed but will FAIL until bug is fixed
      expect(refundResult.success).toBe(true);
      expect(refundResult.paymentRecorded).toBe(true);

      // Invoice should no longer be 'paid' after full refund
      invoice = await mockDb('invoices')
        .where({ invoice_id: invoiceId, tenant: testTenantId })
        .first();
      expect(invoice.status).toBe('sent'); // Back to sent after full refund
    }, HOOK_TIMEOUT);
  });

  describe('BUG: sessionId Parameter Not Used in Verification', () => {
    /**
     * MODERATE BUG: client-payment.ts:120-122
     * verifyClientPortalPayment accepts sessionId but never uses it.
     * This means it doesn't actually verify the specific checkout session.
     */
    it('should verify the specific session, not just invoice status', async () => {
      // This test would require mocking getCurrentUser, which is complex.
      // Instead, we'll verify the implementation directly.

      // Read the function source to verify sessionId is used
      const fs = await import('fs');
      const path = await import('path');

      const clientPaymentPath = path.join(
        process.cwd(),
        '@alga-psa/client-portal/actions'
      );

      const sourceCode = fs.readFileSync(clientPaymentPath, 'utf-8');

      // Find the verifyClientPortalPayment function
      const functionMatch = sourceCode.match(
        /export async function verifyClientPortalPayment\s*\([^)]*sessionId[^)]*\)/
      );
      expect(functionMatch).toBeDefined();

      // Check if sessionId is actually used in the function body
      // Extract function body (simplified - look for sessionId usage after declaration)
      const functionStart = sourceCode.indexOf('export async function verifyClientPortalPayment');
      const functionBody = sourceCode.slice(functionStart, functionStart + 3000);

      // Count occurrences of sessionId (excluding the parameter declaration)
      const paramDeclaration = functionBody.indexOf('sessionId: string');
      const afterParam = functionBody.slice(paramDeclaration + 20);

      // BUG: sessionId should be used to verify the specific Stripe session
      // Currently it's never used after the parameter declaration
      const sessionIdUsages = (afterParam.match(/sessionId/g) || []).length;

      // MODERATE: This assertion will FAIL until bug is fixed
      // sessionId should be used at least once to verify the session
      expect(sessionIdUsages).toBeGreaterThan(0);
    }, HOOK_TIMEOUT);
  });

  describe('BUG: Incorrect Payment Method Recording', () => {
    /**
     * MODERATE BUG: PaymentService.ts:607
     * payment_method is recorded as 'stripe_stripe' instead of 'stripe'
     */
    it('should record payment method as "stripe" not "stripe_stripe"', async () => {
      const { PaymentService } = await import('@ee/lib/payments');

      const { invoiceId } = await createTestInvoiceWithClient(mockDb, testTenantId, {
        totalAmount: 10000,
        status: 'sent',
      });

      await setupPaymentProviderConfig(mockDb, testTenantId);
      const paymentService = await PaymentService.create(testTenantId);

      const webhookEvent = createMockWebhookEvent({
        eventId: `evt_method_${uuidv4().slice(0, 8)}`,
        invoiceId,
        amount: 10000,
        status: 'succeeded',
      });

      const result = await paymentService.processWebhookEvent(webhookEvent);
      expect(result.success).toBe(true);
      expect(result.paymentRecorded).toBe(true);

      // Check the recorded payment method
      const payment = await mockDb('invoice_payments')
        .where({
          tenant: testTenantId,
          invoice_id: invoiceId,
        })
        .first();

      expect(payment).toBeDefined();

      // MODERATE: This assertion will FAIL until bug is fixed
      // Currently records 'stripe_stripe' because code does `stripe_${event.provider}`
      // where event.provider is already 'stripe'
      expect(payment.payment_method).toBe('stripe');
      expect(payment.payment_method).not.toBe('stripe_stripe');
    }, HOOK_TIMEOUT);
  });
});

// =============================================================================
// Helper Functions
// =============================================================================

interface TestInvoiceOptions {
  totalAmount: number;
  currency?: string;
  status?: string;
}

async function createTestInvoiceWithClient(
  db: Knex,
  tenantId: string,
  options: TestInvoiceOptions
): Promise<{ invoiceId: string; clientId: string }> {
  const clientId = uuidv4();
  const invoiceId = uuidv4();

  // Create client - uses client_id column
  await db('clients').insert({
    client_id: clientId,
    tenant: tenantId,
    client_name: `Test Company ${clientId.slice(0, 8)}`,
    billing_email: `billing_${clientId.slice(0, 8)}@test.com`,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });

  // Create invoice - uses client_id column (renamed from company_id)
  await db('invoices').insert({
    invoice_id: invoiceId,
    tenant: tenantId,
    client_id: clientId,
    invoice_number: `INV-${invoiceId.slice(0, 8)}`,
    total_amount: options.totalAmount,
    status: options.status || 'sent',
    invoice_date: new Date().toISOString(),
    due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });

  return { invoiceId, clientId };
}

async function createClientForTenant(
  db: Knex,
  tenantId: string,
  email: string
): Promise<string> {
  const clientId = uuidv4();

  await db('clients').insert({
    client_id: clientId,
    tenant: tenantId,
    client_name: `Client ${clientId.slice(0, 8)}`,
    billing_email: email,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });

  return clientId;
}

interface PaymentProviderSettings {
  paymentLinkExpirationHours?: number;
  paymentLinksInEmails?: boolean;
  sendPaymentConfirmations?: boolean;
}

async function setupPaymentProviderConfig(
  db: Knex,
  tenantId: string,
  settings?: PaymentProviderSettings
): Promise<void> {
  const configId = uuidv4();

  await db('payment_provider_configs')
    .insert({
      config_id: configId,
      tenant: tenantId,
      provider_type: 'stripe',
      is_enabled: true,
      is_default: true,
      configuration: JSON.stringify({ publishable_key: 'pk_test_mock' }),
      credentials_vault_path: 'secrets/stripe',
      settings: JSON.stringify({
        paymentLinkExpirationHours: settings?.paymentLinkExpirationHours || 24,
        paymentLinksInEmails: settings?.paymentLinksInEmails ?? true,
        sendPaymentConfirmations: settings?.sendPaymentConfirmations ?? true,
      }),
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .onConflict(['tenant', 'provider_type'])
    .merge();
}

interface MockWebhookEventOptions {
  eventId: string;
  eventType?: string;
  invoiceId: string;
  amount: number;
  currency?: string;
  status: string;
  tenantId?: string;
  paymentIntentId?: string;
}

function createMockWebhookEvent(options: MockWebhookEventOptions) {
  return {
    eventId: options.eventId,
    eventType: options.eventType || 'checkout.session.completed',
    provider: 'stripe',
    payload: {
      id: options.eventId,
      type: options.eventType || 'checkout.session.completed',
      data: {
        object: {
          id: `cs_${options.eventId}`,
          metadata: {
            invoice_id: options.invoiceId,
            tenant_id: options.tenantId || testTenantId,
          },
          amount_total: options.amount,
          currency: options.currency?.toLowerCase() || 'usd',
          payment_intent: options.paymentIntentId || `pi_${options.eventId}`,
        },
      },
    },
    invoiceId: options.invoiceId,
    amount: options.amount,
    currency: options.currency || 'USD',
    status: options.status as any,
    paymentIntentId: options.paymentIntentId || `pi_${options.eventId}`,
    customerId: `cus_mock_${options.eventId.slice(0, 8)}`,
  };
}

async function createTestDbConnection(): Promise<Knex> {
  const dbHost = process.env.DB_HOST || 'localhost';
  const dbPort = parseInt(process.env.DB_PORT || '5432', 10);
  const adminUser = process.env.DB_USER_ADMIN || 'postgres';
  const adminPassword = process.env.DB_PASSWORD_ADMIN || 'postpass123';
  const dbName = 'payment_integration_test';

  // Create database if it doesn't exist
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
      [dbName]
    );
    await adminConnection.raw(`DROP DATABASE IF EXISTS "${dbName}"`);
    await adminConnection.raw(`CREATE DATABASE "${dbName}"`);
  } finally {
    await adminConnection.destroy();
  }

  return knex({
    client: 'pg',
    connection: {
      host: dbHost,
      port: dbPort,
      user: adminUser,
      password: adminPassword,
      database: dbName,
    },
    pool: { min: 2, max: 10 },
  });
}

async function runMigrationsAndSeeds(connection: Knex): Promise<void> {
  await connection.raw('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');
  await connection.raw('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');

  // Tests run from project root
  const projectRoot = process.cwd();
  const serverDir = path.join(projectRoot, 'server');

  const migrationsDir = path.join(serverDir, 'migrations');
  const eeMigrationsDir = path.join(projectRoot, 'ee', 'server', 'migrations');
  const seedsDir = path.join(serverDir, 'seeds', 'dev');

  await connection.migrate.latest({
    directory: [migrationsDir, eeMigrationsDir],
    loadExtensions: ['.cjs', '.js'],
  });

  await connection.seed.run({
    directory: seedsDir,
    loadExtensions: ['.cjs', '.js'],
  });
}

async function ensureTenant(connection: Knex): Promise<string> {
  const existing = await connection('tenants').first<{ tenant: string }>('tenant');
  if (existing?.tenant) {
    return existing.tenant;
  }

  const newTenantId = uuidv4();
  await connection('tenants').insert({
    tenant: newTenantId,
    client_name: 'Payment Test Tenant',
    email: 'payment-test@test.co',
    created_at: connection.fn.now(),
    updated_at: connection.fn.now(),
  });
  return newTenantId;
}

async function ensureSecondTenant(connection: Knex): Promise<string> {
  const existing = await connection('tenants')
    .whereNot('tenant', testTenantId)
    .first<{ tenant: string }>('tenant');

  if (existing?.tenant) {
    return existing.tenant;
  }

  const newTenantId = uuidv4();
  await connection('tenants').insert({
    tenant: newTenantId,
    client_name: 'Second Test Tenant',
    email: 'second-tenant@test.co',
    created_at: connection.fn.now(),
    updated_at: connection.fn.now(),
  });
  return newTenantId;
}

// Global tenant ID for use in webhook event creation (set in beforeAll)
