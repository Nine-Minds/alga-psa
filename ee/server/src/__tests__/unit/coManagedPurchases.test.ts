import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StripeService } from '../../lib/stripe/StripeService';

const mocks = vi.hoisted(() => ({ connection: vi.fn(), purchase: vi.fn(), reconcile: vi.fn() }));
vi.mock('@/lib/db/db', () => ({ getConnection: mocks.connection }));
vi.mock('@alga-psa/licensing', () => ({ runCoManagedPurchase: mocks.purchase, reconcileHostedCoManagedEntitlement: mocks.reconcile }));
vi.mock('@alga-psa/db', () => ({ tenantDb: (db: any, tenant: string) => ({ table: (table: string) => db(table).where('tenant', tenant) }) }));

const tenant = 'a0000000-0000-4000-8000-000000000001';
const operationId = 'b0000000-0000-4000-8000-000000000001';
const price = { id: 'price_co', currency: 'usd', unit_amount: 1149,
  recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' } };
const metadata = { tenant_id: tenant, subscription_kind: 'co_managed', operation_id: operationId };
const list = (items: any[]) => async function* () { yield* items; };
const co = () => ({ id: 'sub_co', customer: 'cus_msp', status: 'active', metadata,
  items: { data: [{ id: 'si_co', quantity: 4, price }] } });
const checkout = (changes = {}) => ({ id: 'cs_co', customer: 'cus_msp', status: 'open', metadata,
  client_secret: 'secret', ...changes });

function fixture() {
  const rows: Record<string, any[]> = { tenants: [{ tenant, product_code: 'psa', plan: 'pro', billing_source: 'stripe' }],
    stripe_customers: [{ tenant, stripe_customer_external_id: 'cus_msp' }] };
  const db: any = (table: string) => {
    let matches = rows[table] ?? [];
    const query: any = {
      where: (key: string, value: unknown) => { matches = matches.filter(row => row[key] === value); return query; },
      whereIn: (key: string, values: unknown[]) => { matches = matches.filter(row => values.includes(row[key])); return query; },
      first: async () => matches[0],
    };
    return query;
  };
  db.fn = { now: () => new Date() };
  const pro = { id: 'sub_pro', customer: 'cus_msp', status: 'active', metadata: {},
    current_period_end: Math.floor(Date.now() / 1000) + 3600,
    items: { data: [{ id: 'si_pro', quantity: 8, price: { id: 'price_pro' } }] } };
  const subscriptions: any[] = [pro];
  const sessions: any[] = [];
  const service = new StripeService() as any;
  service.initPromise = Promise.resolve();
  service.config = { proPriceId: 'price_pro' };
  service.getOrImportCustomer = vi.fn().mockResolvedValue(rows.stripe_customers[0]);
  service.syncCoManagedSubscription = vi.fn().mockResolvedValue(undefined);
  service.stripe = {
    prices: { retrieve: vi.fn().mockResolvedValue(price) },
    subscriptions: { list: list(subscriptions), update: vi.fn().mockResolvedValue(co()), cancel: vi.fn().mockResolvedValue(co()),
      retrieve: vi.fn().mockResolvedValue(co()) },
    checkout: { sessions: { list: list(sessions), create: vi.fn().mockResolvedValue(checkout()),
      retrieve: vi.fn().mockResolvedValue(checkout()) } },
    invoices: { createPreview: vi.fn().mockResolvedValue({ amount_due: 1700 }) },
  };
  mocks.connection.mockResolvedValue(db);
  mocks.purchase.mockImplementation(async (_db, input, provider) => provider({ operation_id: input.operationId,
    quantity: input.quantity, state: 'preparing', provider_reference: null }));
  return { service, db, rows, subscriptions, sessions, pro };
}

beforeEach(() => { vi.resetAllMocks(); vi.stubEnv('STRIPE_CO_MANAGED_USER_PRICE_ID', 'price_co'); });

describe('dedicated co-managed purchase adapter', () => {
  it('previews the dedicated pool in minor units without mutating subscriptions', async () => {
    const { service, subscriptions } = fixture();
    subscriptions.push(co());
    expect(await service.previewCoManagedSeats(tenant, 6)).toEqual({ unitAmount: 1149, monthlyTotal: 6894, amountDue: 1700, currency: 'usd' });
    expect(service.stripe.invoices.createPreview).toHaveBeenCalledWith(expect.objectContaining({
      subscription: 'sub_co', subscription_details: { items: [{ id: 'si_co', quantity: 6 }], proration_behavior: 'always_invoice' },
    }));
    expect(service.stripe.subscriptions.update).not.toHaveBeenCalled();
    expect(mocks.purchase).not.toHaveBeenCalled();
  });
  it('creates a recoverable embedded checkout for the customer pool only', async () => {
    const { service } = fixture();
    expect(await service.purchaseCoManagedSeats(tenant, 6, operationId)).toEqual({ kind: 'checkout', sessionId: 'cs_co', clientSecret: 'secret' });
    expect(service.stripe.checkout.sessions.create).toHaveBeenCalledWith(expect.objectContaining({
      customer: 'cus_msp', mode: 'subscription', ui_mode: 'embedded', line_items: [{ price: 'price_co', quantity: 6 }],
      metadata, subscription_data: { metadata },
    }), { idempotencyKey: `co-managed:${tenant}:${operationId}` });
    expect(service.stripe.subscriptions.update).not.toHaveBeenCalled();
    expect(service.syncCoManagedSubscription).not.toHaveBeenCalled();
  });
  it('recovers an existing checkout after a lost response without creating another', async () => {
    const { service, sessions } = fixture();
    sessions.push(checkout());
    await service.purchaseCoManagedSeats(tenant, 6, operationId);
    expect(service.stripe.checkout.sessions.create).not.toHaveBeenCalled();
    expect(service.stripe.subscriptions.update).not.toHaveBeenCalled();
  });
  it('resumes a completed checkout and reconciles paid capacity', async () => {
    const { service } = fixture();
    mocks.purchase.mockImplementation(async (_db, _input, provider) => provider({ state: 'checkout', provider_reference: 'cs_co' }));
    service.stripe.checkout.sessions.retrieve.mockResolvedValue(checkout({ status: 'complete', subscription: 'sub_co' }));
    expect(await service.purchaseCoManagedSeats(tenant, 6, operationId)).toEqual({ kind: 'updated', subscriptionId: 'sub_co' });
    expect(service.syncCoManagedSubscription).toHaveBeenCalledWith(tenant, 'sub_co', expect.anything());
    expect(service.stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });
  it('rejects a recovered checkout belonging to another customer', async () => {
    const { service, sessions } = fixture(); sessions.push(checkout({ customer: 'someone_else' }));
    await expect(service.purchaseCoManagedSeats(tenant, 6, operationId)).rejects.toThrow('ownership');
    expect(service.stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });
  it('charges only the co-managed item on an increase', async () => {
    const { service, subscriptions } = fixture(); subscriptions.push(co());
    await service.purchaseCoManagedSeats(tenant, 6, operationId);
    expect(service.stripe.subscriptions.update).toHaveBeenCalledExactlyOnceWith('sub_co', {
      items: [{ id: 'si_co', quantity: 6 }], cancel_at_period_end: false,
      payment_behavior: 'error_if_incomplete', proration_behavior: 'always_invoice',
    }, { idempotencyKey: `co-managed:${tenant}:${operationId}` });
    expect(service.stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });
  it('does not repeat an applied quantity update after provider idempotency expires', async () => {
    const { service, subscriptions } = fixture(); subscriptions.push(co());
    await service.purchaseCoManagedSeats(tenant, 4, operationId);
    expect(service.stripe.subscriptions.update).not.toHaveBeenCalled();
    expect(service.syncCoManagedSubscription).toHaveBeenCalled();
  });
  it('previews and cancels an empty pool without canceling Pro seats', async () => {
    const { service, subscriptions } = fixture(); subscriptions.push(co());
    expect((await service.previewCoManagedSeats(tenant, 0)).monthlyTotal).toBe(0);
    expect(service.stripe.invoices.createPreview).toHaveBeenCalledWith(expect.objectContaining({
      subscription: 'sub_co', subscription_details: { cancel_at: expect.any(Number), proration_behavior: 'always_invoice' },
    }));
    await service.purchaseCoManagedSeats(tenant, 0, operationId);
    expect(service.stripe.subscriptions.cancel).toHaveBeenCalledExactlyOnceWith('sub_co', { invoice_now: true, prorate: true }, { idempotencyKey: `co-managed:${tenant}:${operationId}` });
    expect(service.stripe.subscriptions.update).not.toHaveBeenCalled();
  });
  it.each(['essentials', 'solo'])('denies %s sponsorship before contacting the purchase provider', async (plan) => {
    const { service, rows } = fixture(); rows.tenants[0].plan = plan;
    await expect(service.purchaseCoManagedSeats(tenant, 6, operationId)).rejects.toThrow('Pro PSA');
    expect(mocks.purchase).not.toHaveBeenCalled();
  });
  it('rejects stale local Pro eligibility when the actual subscription expired', async () => {
    const { service, pro } = fixture(); pro.current_period_end = 1;
    await expect(service.purchaseCoManagedSeats(tenant, 6, operationId)).rejects.toThrow('current Pro');
    expect(service.stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });
  it('finalizes a replacement checkout under purchase locks before entitlement reconciliation', async () => {
    const { service, rows, db } = fixture();
    rows.co_managed_purchase_operations = [{ tenant, operation_id: operationId, quantity: 4, state: 'checkout' }];
    await service.handleCheckoutCompleted({ data: { object: checkout({ status: 'complete', subscription: 'sub_co' }) } }, tenant, db);
    expect(mocks.purchase).toHaveBeenCalledWith(db, { sponsorTenant: tenant, operationId, quantity: 4 }, expect.any(Function));
    expect(mocks.purchase.mock.invocationCallOrder[0]).toBeLessThan(service.syncCoManagedSubscription.mock.invocationCallOrder[0]);
  });
  it('rejects checkout completion with a different authorized quantity', async () => {
    const { service, rows, db } = fixture();
    rows.co_managed_purchase_operations = [{ tenant, operation_id: operationId, quantity: 99, state: 'checkout' }];
    await expect(service.handleCheckoutCompleted({ data: { object: checkout({ subscription: 'sub_co' }) } }, tenant, db)).rejects.toThrow('authorized purchase');
    expect(mocks.purchase).not.toHaveBeenCalled();
    expect(service.syncCoManagedSubscription).not.toHaveBeenCalled();
  });
});
