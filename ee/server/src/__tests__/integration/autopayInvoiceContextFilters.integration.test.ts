import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { createTestDbConnection } from '@main-test-utils/dbConfig';

// AutopayService reads through @alga-psa/db's connection; point it at the
// fixture transaction so every seeded row is rolled back after the test.
const connection = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('@alga-psa/db', async () => {
  const actual = await vi.importActual<typeof import('@alga-psa/db')>('@alga-psa/db');
  return { ...actual, getConnection: vi.fn(async () => connection.current) };
});

import { AutopayService } from '../../lib/payments/AutopayService';

let db: Knex;

async function seedFixture(trx: Knex.Transaction) {
  const tenant = randomUUID();
  const clientId = randomUUID();
  const billingProfileId = randomUUID();
  const invoiceId = randomUUID();
  const enrolledCardId = randomUUID();
  const otherCardId = randomUUID();

  await trx('tenants').insert({ tenant, client_name: 'Autopay Context Tenant', email: `autopay-${tenant}@example.test` });
  await trx('clients').insert({ tenant, client_id: clientId, client_name: 'Autopay Context Client' });
  await trx('client_billing_profiles').insert({ tenant, billing_profile_id: billingProfileId, client_id: clientId, name: 'Default', is_default: true });
  await trx('invoices').insert({
    tenant, invoice_id: invoiceId, client_id: clientId, billing_profile_id: billingProfileId,
    invoice_number: `AUTOPAY-${invoiceId.slice(0, 8)}`, invoice_date: trx.fn.now(), due_date: trx.raw("now() + interval '30 days'"),
    total_amount: 12000, status: 'sent',
  });
  const card = (paymentMethodId: string, last4: string) => ({
    tenant, payment_method_id: paymentMethodId, client_id: clientId, billing_profile_id: billingProfileId, type: 'credit_card',
    last4, brand: 'visa', provider_type: 'stripe', external_payment_method_id: `pm_${last4}`, external_customer_id: 'cus_autopay', status: 'active',
  });
  await trx('payment_methods').insert([card(enrolledCardId, '4242'), card(otherCardId, '1881')]);
  await trx('billing_profile_autopay').insert({ tenant, billing_profile_id: billingProfileId, client_id: clientId, is_enabled: true, payment_method_id: enrolledCardId });
  await trx('invoice_autopay_attempts').insert({
    tenant, invoice_id: invoiceId, billing_profile_id: billingProfileId, payment_method_id: enrolledCardId, attempt_number: 1,
    scheduled_for: trx.raw("now() + interval '1 day'"), status: 'scheduled', amount: 12000, currency: 'USD', provider_type: 'stripe',
    idempotency_key: `autopay-${invoiceId}-1`,
  });

  return { tenant, billingProfileId, invoiceId, enrolledCardId, otherCardId };
}

describe('invoice auto-pay context enrollment and card filters (DB integration)', () => {
  beforeAll(async () => {
    process.env.DB_PORT = process.env.DB_PORT || '5432';
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    db = await createTestDbConnection();
  });

  afterAll(async () => { await db?.destroy().catch(() => undefined); });

  it('returns only enabled enrollments with their active, non-deleted matching method', async () => {
    const trx = await db.transaction();
    connection.current = trx;
    try {
      const { tenant, billingProfileId, invoiceId, enrolledCardId, otherCardId } = await seedFixture(trx);
      const contexts = () => AutopayService.create(tenant).then((service) => service.getInvoiceAutopayContexts([invoiceId]));
      const enrollment = () => trx('billing_profile_autopay').where({ tenant, billing_profile_id: billingProfileId });
      const enrolledCard = () => trx('payment_methods').where({ tenant, payment_method_id: enrolledCardId });

      expect(await contexts()).toEqual({ [invoiceId]: expect.objectContaining({ status: 'scheduled', brand: 'visa', last4: '4242' }) });

      await enrollment().update({ is_enabled: false });
      expect(await contexts()).toEqual({});

      // Re-enrolled on a different card: the pending attempt's card no longer matches.
      await enrollment().update({ is_enabled: true, payment_method_id: otherCardId });
      expect(await contexts()).toEqual({});

      await enrollment().update({ payment_method_id: enrolledCardId });
      await enrolledCard().update({ is_deleted: true });
      expect(await contexts()).toEqual({});

      await enrolledCard().update({ is_deleted: false, status: 'detached' });
      expect(await contexts()).toEqual({});

      await enrolledCard().update({ status: 'active' });
      expect(await contexts()).toEqual({ [invoiceId]: expect.objectContaining({ last4: '4242' }) });
    } finally {
      await trx.rollback();
      connection.current = null;
    }
  });
});
