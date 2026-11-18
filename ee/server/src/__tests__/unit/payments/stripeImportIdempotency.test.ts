import { describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/db', () => ({ getConnection: vi.fn(), tenantDb: vi.fn() }));
vi.mock('@alga-psa/billing/services/invoiceBillingRecipientService', () => ({ resolveInvoiceBillingRecipient: vi.fn() }));
vi.mock('../../../lib/payments/StripePaymentProvider', () => ({ createStripePaymentProvider: vi.fn() }));

import { customerStampIdempotencyKey, StripeCustomerImportService, type StripeImportGateway } from '../../../lib/payments/StripeCustomerImportService';

const row = (customerId = 'cus_1') => ({
  rowId: 'r1', action: 'adopt', reason: undefined, clientId: 'c1', billingProfileId: 'p1', customerId,
  needsCustomerStamp: true, needsMapping: false, cards: [], customerEmail: null, customerName: null,
}) as any;

/** Replays by idempotency key like Stripe: a reused key returns the first response and writes nothing. */
function replayingGateway(store: { metadata: Record<string, string> }, opts: { lands?: boolean } = {}) {
  const cache = new Map<string, Record<string, string>>();
  const keys: string[] = [];
  const gateway = {
    capabilities: () => ({ supportedCurrencies: ['USD'] }),
    updateCustomerMetadata: vi.fn(async (_id: string, metadata: Record<string, string>, key: string) => {
      keys.push(key);
      if (cache.has(key)) return cache.get(key)!;
      if (opts.lands !== false) store.metadata = { ...store.metadata, ...metadata };
      const out = { ...store.metadata };
      cache.set(key, out);
      return out;
    }),
    updateSavedPaymentMethodMetadata: vi.fn(),
  } as unknown as StripeImportGateway;
  return { gateway, keys };
}

// Local writes are out of scope here (covered by the DB integration test): the transaction body is not run.
const knexStub = () => ({ transaction: vi.fn(async () => undefined) }) as any;

describe('Stripe customer import stamp idempotency and verification', () => {
  it('re-stamps after drift with a fresh key per attempt', async () => {
    const store = { metadata: {} as Record<string, string> };
    const { gateway, keys } = replayingGateway(store);
    const service = new StripeCustomerImportService('t1', knexStub(), gateway);
    const plan = { rows: [row()] } as any;

    expect((await service.execute(plan))[0].status).toBe('imported');
    expect(store.metadata).toMatchObject({ tenant_id: 't1', client_id: 'c1', billing_profile_id: 'p1', source: 'alga_import' });

    store.metadata = {}; // drift
    expect((await service.execute(plan))[0].status).toBe('imported');
    expect(keys[1]).not.toBe(keys[0]);
    expect(store.metadata.client_id).toBe('c1');
  });

  it('fails the row, before any local write, when the returned metadata is not stamped', async () => {
    const store = { metadata: {} as Record<string, string> };
    const { gateway } = replayingGateway(store, { lands: false });
    const knex = knexStub();
    const result = (await new StripeCustomerImportService('t1', knex, gateway).execute({ rows: [row()] } as any))[0];
    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/did not persist/);
    expect(knex.transaction).not.toHaveBeenCalled();
  });

  it('fails the row when a card stamp does not land', async () => {
    const { gateway } = replayingGateway({ metadata: {} });
    (gateway.updateSavedPaymentMethodMetadata as any).mockResolvedValue({});
    const knex = knexStub();
    const r = row(); r.needsCustomerStamp = false;
    r.cards = [{ action: 'import', externalPaymentMethodId: 'pm_1' }];
    const result = (await new StripeCustomerImportService('t1', knex, gateway).execute({ rows: [r] } as any))[0];
    expect(result.status).toBe('failed');
    expect(knex.transaction).not.toHaveBeenCalled();
  });

  it('keeps retries within one attempt stable and the key under 255 chars', () => {
    const stamp = { tenant_id: 't', source: 'alga_import' };
    const a = customerStampIdempotencyKey('t', row(), 'att-1', stamp);
    expect(customerStampIdempotencyKey('t', row(), 'att-1', stamp)).toBe(a);
    expect(customerStampIdempotencyKey('t', row(), 'att-2', stamp)).not.toBe(a);
    const uuid = '00000000-0000-0000-0000-000000000000';
    expect(customerStampIdempotencyKey(uuid, { customerId: 'cus_' + 'x'.repeat(24), clientId: uuid, billingProfileId: uuid }, uuid, stamp).length).toBeLessThan(255);
  });
});
