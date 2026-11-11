import { afterAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { recordingKnex, type CapturedKnexQuery } from '../../../../../../server/src/test/helpers/recordingKnex';
import { StripeCustomerImportService, type StripeImportGateway } from '../../../lib/payments/StripeCustomerImportService';
import { classifyImport, type StripeCustomerSnapshot } from '../../../lib/payments/stripeImportClassifier';

const TENANT = 'b9d9fac3-dec7-4fb3-ae89-80b9d17f2cd7';
const CLIENT = '00000000-0000-4000-8000-000000000001';
const PROFILE = '00000000-0000-4000-8000-000000000002';
const CUSTOMER = 'cus_ManagedNerds';
const PAYMENT_METHOD = 'pm_ManagedNerds';
const STAMP = { tenant_id: TENANT, client_id: CLIENT, billing_profile_id: PROFILE, source: 'alga_import' };

const cardCustomer: StripeCustomerSnapshot = {
  id: CUSTOMER,
  email: 'billing@managednerds.test',
  name: 'Managed Nerds',
  currency: 'usd',
  defaultPaymentMethodId: PAYMENT_METHOD,
  metadata: {},
  paymentMethods: [{
    id: PAYMENT_METHOD,
    type: 'card',
    created: 1_794_000_000,
    metadata: {},
    offSessionEvidence: true,
    card: { brand: 'visa', last4: '4242', expMonth: 9, expYear: 2031, fingerprint: 'fp_managed_nerds' },
  }],
};

const dbs: Knex[] = [];

afterAll(async () => {
  await Promise.all(dbs.map((db) => db.destroy()));
});

describe('Stripe customer card imports on Citus', () => {
  it('commits the mapping and card together, then sets the default with UPDATE', async () => {
    const queries: CapturedKnexQuery[] = [];
    const db = recordingKnex(queries, ({ sql }) => ({
      rows: /^\s*select\b/i.test(sql) ? [] : [{}],
      command: /^\s*select\b/i.test(sql) ? 'SELECT' : sql.trim().split(/\s+/, 1)[0].toUpperCase(),
    }));
    dbs.push(db);

    const gateway: StripeImportGateway = {
      getCustomerImportSnapshot: vi.fn(async () => cardCustomer),
      listCustomersForImport: vi.fn(async () => ({ customers: [cardCustomer], truncated: false })),
      updateCustomerMetadata: vi.fn(async (_id, metadata) => metadata),
      updateSavedPaymentMethodMetadata: vi.fn(async (_id, metadata) => metadata),
      capabilities: () => ({ supportedCurrencies: ['USD'] }),
    };
    const plan = classifyImport({
      rows: [{ rowId: 'managed-nerds', clientId: CLIENT, billingProfileId: PROFILE, customerId: CUSTOMER }],
      customers: [cardCustomer],
      alga: {
        tenantId: TENANT,
        profiles: [{ clientId: CLIENT, billingProfileId: PROFILE, clientName: 'Managed Nerds', profileName: 'Default', isActive: true, currency: 'usd' }],
        mappings: [], paymentMethods: [], enrolledProfileIds: [], supportedCurrencies: ['USD'], now: new Date('2026-11-11T12:00:00.000Z'),
      },
    });

    const results = await new StripeCustomerImportService(TENANT, db, gateway).execute(plan);

    expect(results).toMatchObject([{ status: 'imported', cardsImported: 1 }]);
    expect(gateway.updateCustomerMetadata).toHaveBeenCalledWith(CUSTOMER, STAMP, expect.any(String));
    expect(gateway.updateSavedPaymentMethodMetadata).toHaveBeenCalledWith(PAYMENT_METHOD, STAMP);

    const cardUpsert = queries.find(({ sql }) => /INSERT INTO payment_methods/i.test(sql));
    expect(cardUpsert).toBeDefined();
    const conflictAction = /DO UPDATE SET([\s\S]*?)(?:\bWHERE\b|\bRETURNING\b|$)/i.exec(cardUpsert!.sql)?.[1];
    expect(conflictAction).toBeDefined();
    expect(conflictAction).not.toMatch(/\b(?:now\s*\(|current_timestamp|localtimestamp|clock_timestamp\s*\(|statement_timestamp\s*\(|transaction_timestamp\s*\()/i);
    expect(conflictAction).toMatch(/updated_at\s*=\s*EXCLUDED\.updated_at/i);

    const mappingWrite = queries.find(({ sql }) => /INSERT INTO .*client_payment_customers/i.test(sql));
    const defaultUpdate = queries.find(({ sql }) => /UPDATE .*payment_methods/i.test(sql) && !/INSERT INTO/i.test(sql));
    expect(mappingWrite).toBeDefined();
    expect(defaultUpdate).toBeDefined();
    expect(defaultUpdate!.sql).not.toMatch(/ON CONFLICT/i);
    expect(defaultUpdate!.sql).toMatch(/"is_default"\s*=\s*\$\d+/i);
    expect(defaultUpdate!.bindings).toContain(true);
    expect(defaultUpdate!.bindings).toContain(PAYMENT_METHOD);

    const beginIndex = queries.findIndex(({ sql }) => /^\s*BEGIN\b/i.test(sql));
    const commitIndex = queries.findIndex(({ sql }) => /^\s*COMMIT\b/i.test(sql));
    expect(beginIndex).toBeGreaterThanOrEqual(0);
    expect(commitIndex).toBeGreaterThan(beginIndex);
    expect(queries.slice(beginIndex + 1, commitIndex)).toContain(mappingWrite);
    expect(queries.slice(beginIndex + 1, commitIndex)).toContain(cardUpsert);
    expect(queries.filter(({ sql }) => /^\s*BEGIN\b/i.test(sql))).toHaveLength(1);
    expect(queries.filter(({ sql }) => /^\s*COMMIT\b/i.test(sql))).toHaveLength(1);

    const expectedCardBindings = [TENANT, CLIENT, PROFILE, '4242', '9', '2031', PAYMENT_METHOD, CUSTOMER, 'visa', 'fp_managed_nerds'];
    for (const value of expectedCardBindings) expect(cardUpsert!.bindings).toContain(value);
    expect(cardUpsert!.sql).toMatch(/'credit_card'.*false, false, 'stripe'/is);
    expect(cardUpsert!.sql).toMatch(/'active'/i);
    const timestamps = cardUpsert!.bindings.filter((value) => typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value));
    expect(timestamps).toHaveLength(2);
    expect(timestamps[0]).toBe(timestamps[1]);
    expect(cardUpsert!.bindings.slice(-2)).toEqual(timestamps);
    expect(mappingWrite!.bindings).toContain(CUSTOMER);
    expect(mappingWrite!.bindings).toContain('billing@managednerds.test');
  });
});
