import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { createTestDbConnection } from '@main-test-utils/dbConfig';

const connection = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('@alga-psa/db', async () => {
  const actual = await vi.importActual<typeof import('@alga-psa/db')>('@alga-psa/db');
  return { ...actual, getConnection: vi.fn(async () => connection.current) };
});

import { StripePaymentProvider } from '../../lib/payments/StripePaymentProvider';
import { StripeCustomerImportService, type StripeImportGateway } from '../../lib/payments/StripeCustomerImportService';
import type { StripeCustomerSnapshot } from '../../lib/payments/stripeImportClassifier';

let db: Knex;

const card = (id: string, created: number, evidence = true) => ({
  id, type: 'card', created, metadata: {} as Record<string, string>, offSessionEvidence: evidence,
  card: { brand: 'visa', last4: id.slice(-4).padStart(4, '0'), expMonth: 7, expYear: 2031, fingerprint: `fp_${id}` },
});

/** A fake Stripe account that records every write in order. */
function fakeStripe(customers: Record<string, StripeCustomerSnapshot>, events: string[]): StripeImportGateway {
  return {
    capabilities: () => ({ supportedCurrencies: ['USD', 'EUR'] }),
    getCustomerImportSnapshot: async (id) => (customers[id] ? structuredClone(customers[id]) : null),
    listCustomersForImport: async () => ({ customers: Object.values(customers), truncated: false }),
    updateCustomerMetadata: async (id, metadata) => { events.push(`customer:${id}`); customers[id].metadata = { ...customers[id].metadata, ...metadata }; return { ...customers[id].metadata }; },
    updateSavedPaymentMethodMetadata: async (id, metadata) => {
      events.push(`pm:${id}`);
      for (const c of Object.values(customers)) for (const pm of c.paymentMethods) if (pm.id === id) pm.metadata = { ...pm.metadata, ...metadata };
      for (const c of Object.values(customers)) for (const pm of c.paymentMethods) if (pm.id === id) return { ...pm.metadata };
      return {};
    },
  };
}

describe('StripeCustomerImportService executor (DB integration)', () => {
  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    db = await createTestDbConnection();
  }, 590_000);
  afterAll(async () => { await db?.destroy().catch(() => undefined); });

  async function seed(trx: Knex.Transaction, currency = 'USD') {
    const tenant = randomUUID(); const clientId = randomUUID(); const profileId = randomUUID();
    await trx('tenants').insert({ tenant, client_name: 'Import Tenant', email: `imp-${tenant}@example.test` });
    await trx('clients').insert({ tenant, client_id: clientId, client_name: 'Import Client', default_currency_code: currency });
    await trx('client_billing_profiles').insert({ tenant, billing_profile_id: profileId, client_id: clientId, name: 'Default', is_default: true });
    return { tenant, clientId, profileId };
  }

  it('stamps Stripe metadata before writing the mapping, matches the SavedPaymentMethodService row shape, sets default in a second pass, and is idempotent', async () => {
    const trx = await db.transaction();
    try {
      const { tenant, clientId, profileId } = await seed(trx);
      const events: string[] = [];
      const customers: Record<string, StripeCustomerSnapshot> = {
        cus_import1: { id: 'cus_import1', email: 'ap@x.test', name: 'X', currency: null, defaultPaymentMethodId: 'pm_aaaa1111', metadata: {},
          paymentMethods: [card('pm_aaaa1111', 100), card('pm_bbbb2222', 200, false), { id: 'pm_bank', type: 'us_bank_account', created: 1, metadata: {}, offSessionEvidence: false }] },
      };
      const service = new StripeCustomerImportService(tenant, trx as unknown as Knex, fakeStripe(customers, events));
      connection.current = trx;

      // Observe the mapping write relative to the Stripe stamp.
      const mappingAtStamp: boolean[] = [];
      const gateway = fakeStripe(customers, events);
      const original = gateway.updateCustomerMetadata;
      gateway.updateCustomerMetadata = async (...args) => {
        mappingAtStamp.push(!!(await trx('client_payment_customers').where({ tenant, client_id: clientId }).first()));
        return original(...args);
      };
      const svc = new StripeCustomerImportService(tenant, trx as unknown as Knex, gateway);

      const plan = await svc.preview([{ rowId: 'r1', clientId, billingProfileId: profileId, customerId: 'cus_import1' }]);
      expect(plan.rows[0].action).toBe('adopt');
      expect(plan.rows[0].cards.find((c) => c.externalPaymentMethodId === 'pm_bank')).toMatchObject({ action: 'skip', reason: 'unsupported-method' });
      expect(await trx('client_payment_customers').where({ tenant })).toHaveLength(0); // preview writes nothing

      const enroll = vi.fn();
      const results = await svc.execute(plan, { enroll });
      expect(results[0]).toMatchObject({ status: 'imported', cardsImported: 2, enrollment: 'not-requested' });
      expect(enroll).not.toHaveBeenCalled(); // import alone never enrolls
      expect(mappingAtStamp).toEqual([false]); // metadata stamped while no mapping existed yet
      expect(events[0]).toBe('customer:cus_import1');

      const mapping = await trx('client_payment_customers').where({ tenant, client_id: clientId, billing_profile_id: profileId }).first();
      expect(mapping.external_customer_id).toBe('cus_import1');
      const methods = await trx('payment_methods').where({ tenant }).orderBy('external_payment_method_id');
      expect(methods).toHaveLength(2);
      expect(methods[0]).toMatchObject({
        client_id: clientId, billing_profile_id: profileId, type: 'credit_card', last4: '1111', exp_month: '7', exp_year: '2031',
        provider_type: 'stripe', external_payment_method_id: 'pm_aaaa1111', external_customer_id: 'cus_import1', brand: 'visa',
        fingerprint: 'fp_pm_aaaa1111', status: 'active', is_deleted: false, is_default: true,
      });
      expect(methods.filter((m: any) => m.is_default)).toHaveLength(1); // customer's own default won

      // Re-run: nothing new, no Stripe writes.
      const writesBefore = events.length;
      const plan2 = await svc.preview([{ rowId: 'r1', clientId, billingProfileId: profileId, customerId: 'cus_import1' }]);
      expect(plan2.rows[0].action).toBe('already-imported');
      const results2 = await svc.execute(plan2);
      expect(results2[0]).toMatchObject({ status: 'unchanged', cardsImported: 0 });
      expect(events.length).toBe(writesBefore);
      expect(await trx('payment_methods').where({ tenant })).toHaveLength(2);
      expect(await trx('client_payment_customers').where({ tenant })).toHaveLength(1);
      void service;
    } finally { await trx.rollback(); }
  });

  it('enrolls only attested rows, through the enroll callback with the default card', async () => {
    const trx = await db.transaction();
    try {
      const { tenant, clientId, profileId } = await seed(trx, 'EUR');
      connection.current = trx;
      const customers: Record<string, StripeCustomerSnapshot> = {
        cus_import2: { id: 'cus_import2', email: null, name: null, currency: 'eur', defaultPaymentMethodId: null, metadata: {}, paymentMethods: [card('pm_cccc3333', 100)] },
      };
      const svc = new StripeCustomerImportService(tenant, trx as unknown as Knex, fakeStripe(customers, []));
      const input = [{ rowId: 'r1', clientId, billingProfileId: profileId, customerId: 'cus_import2' }];
      const enroll = vi.fn().mockResolvedValue(undefined);

      const unattested = await svc.execute(await svc.preview(input), { enroll });
      expect(unattested[0].enrollment).toBe('not-requested');
      expect(enroll).not.toHaveBeenCalled();

      // Attestation on a later (already-imported) run enrolls with the internal id of the default card.
      const plan = await svc.preview(input);
      expect(plan.rows[0]).toMatchObject({ action: 'already-imported', enrollable: true, currency: 'eur' });
      const attested = await svc.execute(plan, { attestedRowIds: ['r1'], enroll });
      expect(attested[0].enrollment).toBe('enrolled');
      const pm = await trx('payment_methods').where({ tenant, external_payment_method_id: 'pm_cccc3333' }).first();
      expect(enroll).toHaveBeenCalledWith(expect.objectContaining({ clientId, billingProfileId: profileId }), pm.payment_method_id);
    } finally { await trx.rollback(); }
  });

  it('getOrCreateCustomer reuses an imported cus_ instead of creating or listing customers', async () => {
    const trx = await db.transaction();
    try {
      const { tenant, clientId, profileId } = await seed(trx);
      connection.current = trx;
      const customers: Record<string, StripeCustomerSnapshot> = {
        cus_import3: { id: 'cus_import3', email: 'a@x.test', name: 'A', currency: null, defaultPaymentMethodId: null, metadata: {}, paymentMethods: [card('pm_dddd4444', 1)] },
      };
      const svc = new StripeCustomerImportService(tenant, trx as unknown as Knex, fakeStripe(customers, []));
      await svc.execute(await svc.preview([{ rowId: 'r1', clientId, billingProfileId: profileId, customerId: 'cus_import3' }]));

      const stripe = {
        customers: {
          retrieve: vi.fn(async () => ({ id: 'cus_import3', metadata: customers.cus_import3.metadata })),
          update: vi.fn(), list: vi.fn(), create: vi.fn(),
        },
      };
      const provider = new StripePaymentProvider(tenant);
      (provider as any).stripe = stripe;
      await expect(provider.getOrCreateCustomer(clientId, 'a@x.test', 'A', profileId)).resolves.toBe('cus_import3');
      expect(stripe.customers.create).not.toHaveBeenCalled();
      expect(stripe.customers.list).not.toHaveBeenCalled();
      expect(await trx('client_payment_customers').where({ tenant })).toHaveLength(1);
    } finally { await trx.rollback(); }
  });

  it('re-stamps after Stripe metadata drift despite idempotency replay, and fails the row (no mapping) when the stamp does not land', async () => {
    const trx = await db.transaction();
    try {
      const { tenant, clientId, profileId } = await seed(trx);
      connection.current = trx;
      const customers: Record<string, StripeCustomerSnapshot> = {
        cus_drift1: { id: 'cus_drift1', email: 'a@x.test', name: 'A', currency: null, defaultPaymentMethodId: null, metadata: {}, paymentMethods: [card('pm_eeee5555', 1)] },
      };
      // Stripe-like replay: a reused key returns the first response and writes nothing.
      const cache = new Map<string, Record<string, string>>();
      const keys: string[] = [];
      const base = fakeStripe(customers, []);
      let landStamp = true;
      const gateway: StripeImportGateway = {
        ...base,
        updateCustomerMetadata: async (id, metadata, key) => {
          keys.push(key);
          if (cache.has(key)) return cache.get(key)!;
          const out = landStamp ? await base.updateCustomerMetadata(id, metadata, key) : { ...customers[id].metadata };
          cache.set(key, out);
          return out;
        },
      };
      const svc = new StripeCustomerImportService(tenant, trx as unknown as Knex, gateway);
      const input = [{ rowId: 'r1', clientId, billingProfileId: profileId, customerId: 'cus_drift1' }];

      expect((await svc.execute(await svc.preview(input)))[0].status).toBe('imported');
      expect(customers.cus_drift1.metadata.client_id).toBe(clientId);

      customers.cus_drift1.metadata = {}; // drift
      const plan = await svc.preview(input);
      expect(plan.rows[0].needsCustomerStamp).toBe(true);
      expect((await svc.execute(plan))[0].status).toBe('imported');
      expect(keys[1]).not.toBe(keys[0]);
      expect(customers.cus_drift1.metadata).toMatchObject({ tenant_id: tenant, client_id: clientId, billing_profile_id: profileId, source: 'alga_import' });
      expect(await trx('client_payment_customers').where({ tenant })).toHaveLength(1);

      // A gateway that reports unstamped metadata fails the row and writes no mapping.
      const other = await seed(trx);
      customers.cus_drift2 = { id: 'cus_drift2', email: null, name: null, currency: null, defaultPaymentMethodId: null, metadata: {}, paymentMethods: [] };
      landStamp = false;
      const svc2 = new StripeCustomerImportService(other.tenant, trx as unknown as Knex, gateway);
      const input2 = [{ rowId: 'r2', clientId: other.clientId, billingProfileId: other.profileId, customerId: 'cus_drift2' }];
      const res = await svc2.execute(await svc2.preview(input2));
      expect(res[0].status).toBe('failed');
      expect(res[0].error).toMatch(/did not persist/);
      expect(await trx('client_payment_customers').where({ tenant: other.tenant })).toHaveLength(0);
    } finally { await trx.rollback(); }
  });
});
