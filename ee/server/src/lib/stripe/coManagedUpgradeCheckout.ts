import Stripe from 'stripe';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { prepareCoManagedUpgradePurchase, withCoManagedUpgradePurchaseAdmin, isCoManagedUuid,
  type CoManagedSessionActor, type CoManagedUpgradePurchase, type CoManagedUpgradePurchaseRequest } from '@alga-psa/co-managed';
import { paidPsaUpgradeFromStripe } from './coManagedIndependentEntitlement';

export const INDEPENDENT_UPGRADE_SOURCE = 'co_managed_independent_upgrade';
const id = (value: any): string | undefined => typeof value === 'string' ? value : value?.id;
const metadata = (operation: CoManagedUpgradePurchase) => ({ tenant_id: operation.tenant, operation_id: operation.operation_id,
  source: INDEPENDENT_UPGRADE_SOURCE, billing_interval: operation.billing_interval });
const matches = (value: Stripe.Metadata | null | undefined, operation: CoManagedUpgradePurchase) =>
  value?.tenant_id === operation.tenant && value?.operation_id === operation.operation_id && value?.source === INDEPENDENT_UPGRADE_SOURCE;
export type IndependentCheckoutResult = { kind: 'checkout'; clientSecret: string; publishableKey: string } | { kind: 'paid' | 'processing' | 'expired' };

export async function independentCheckoutStripeContext() {
  const secrets = await getSecretProviderInstance();
  const secret = await secrets.getAppSecret('stripe_secret_key') || process.env.STRIPE_SECRET_KEY;
  const publishableKey = await secrets.getAppSecret('stripe_publishable_key') || process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  if (!secret || !publishableKey) throw new Error('Stripe checkout is not configured');
  return { stripe: new Stripe(secret, { apiVersion: '2024-12-18.acacia' as any, typescript: true }), publishableKey };
}

async function operation(db: Knex, tenant: string, operationId: string) {
  if (!isCoManagedUuid(tenant) || !isCoManagedUuid(operationId)) throw new Error('Invalid checkout identity');
  const row = await tenantDb(db, tenant).table<CoManagedUpgradePurchase>('co_managed_upgrade_purchases').where('operation_id', operationId).first();
  if (!row) throw new Error('Independent checkout was not authorized');
  return row;
}

async function retainOperation(trx: Knex.Transaction, tenant: string, operationId: string) {
  const own = tenantDb(trx, tenant);
  if (!await own.table('tenants').forUpdate().first('tenant') || await trx('license_state').first('id')) throw new Error('Hosted checkout owner is unavailable');
  return operation(trx, tenant, operationId);
}

function assertCustomer(customer: Stripe.Customer | Stripe.DeletedCustomer, tenant: string): asserts customer is Stripe.Customer {
  if (customer.deleted || customer.metadata?.tenant_id !== tenant) throw new Error('Stripe customer does not belong to this workspace');
}

async function resolveCustomer(stripe: Stripe, purchase: CoManagedUpgradePurchase, info: { name: string; email: string; externalId?: string }) {
  if (purchase.customer_id || info.externalId) {
    const customer = await stripe.customers.retrieve(purchase.customer_id || info.externalId!);
    assertCustomer(customer, purchase.tenant); return customer;
  }
  // Recover our own creation by tenant metadata. Email never establishes ownership.
  const candidates: Stripe.Customer[] = [];
  for await (const customer of stripe.customers.search({ query: `metadata['tenant_id']:'${purchase.tenant}' AND metadata['source']:'${INDEPENDENT_UPGRADE_SOURCE}'`, limit: 100 })) {
    candidates.push(customer); if (candidates.length > 1) throw new Error('Ambiguous independent billing customer');
  }
  if (candidates[0]) { assertCustomer(candidates[0], purchase.tenant); return candidates[0]; }
  // Stripe idempotency keys may expire after a day. Do not create a second
  // provider object when an old response is still unresolved.
  if (Date.now() - new Date(purchase.created_at).getTime() > 23 * 3600000) throw new Error('The pending purchase needs provider reconciliation');
  const customer = await stripe.customers.create({ name: info.name, email: info.email, metadata: metadata(purchase) },
    { idempotencyKey: `co-upgrade-customer:${purchase.tenant}:${purchase.operation_id}` });
  assertCustomer(customer, purchase.tenant); return customer;
}

async function findCheckoutSession(stripe: Stripe, purchase: CoManagedUpgradePurchase): Promise<string | null> {
  if (purchase.checkout_session_id) return purchase.checkout_session_id;
  let found: string | null = null;
  for await (const session of stripe.checkout.sessions.list({ customer: purchase.customer_id!, limit: 100 })) {
    if (!matches(session.metadata, purchase)) continue;
    if (found) throw new Error('Ambiguous independent checkout');
    found = session.id;
  }
  return found;
}

async function saveCustomer(trx: Knex.Transaction, purchase: CoManagedUpgradePurchase, customer: Stripe.Customer) {
  const own = tenantDb(trx, purchase.tenant), current = await retainOperation(trx, purchase.tenant, purchase.operation_id);
  if (current.customer_id && current.customer_id !== customer.id) throw new Error('Independent billing customer changed');
  const existing = await own.table('stripe_customers').first('stripe_customer_external_id');
  if (existing && existing.stripe_customer_external_id !== customer.id) throw new Error('Workspace billing ownership changed');
  await own.table('stripe_customers').insert({ tenant: purchase.tenant, stripe_customer_external_id: customer.id,
    email: customer.email ?? '', name: customer.name, metadata: customer.metadata,
    billing_tenant: process.env.MASTER_BILLING_TENANT_ID || null }).onConflict(['tenant', 'stripe_customer_external_id']).ignore();
  await own.table('co_managed_upgrade_purchases').where('operation_id', purchase.operation_id).update({ customer_id: customer.id, updated_at: trx.fn.now() });
}

function assertSession(session: Stripe.Checkout.Session, purchase: CoManagedUpgradePurchase) {
  const items = session.line_items?.data;
  if (!matches(session.metadata, purchase) || id(session.customer) !== purchase.customer_id || session.client_reference_id !== purchase.tenant ||
      session.mode !== 'subscription' || !items || items.length !== 1 || items[0].quantity !== purchase.quantity || id(items[0].price) !== purchase.price_id ||
      (purchase.checkout_session_id && purchase.checkout_session_id !== session.id)) throw new Error('Checkout does not match the authorized independent purchase');
}

/** Store only this customer's provider billing. Operational seats, tier, trust
 * and deletion lifecycle are controlled elsewhere until product conversion. */
async function storeUpgradeSubscription(trx: Knex.Transaction, purchase: CoManagedUpgradePurchase,
  subscription: Stripe.Subscription, validUntil?: Date) {
  const tenant = purchase.tenant, own = tenantDb(trx, tenant);
  const item = subscription.items.data[0];
  if (subscription.items.data.length !== 1 || !item || !Number.isSafeInteger(item.quantity) || item.quantity! < 0)
    throw new Error('Independent seat subscription is ambiguous');
  const price = item.price, product = price.product;
  if (!product || typeof product === 'string' || 'deleted' in product || price.unit_amount === null) throw new Error('PSA price product is unavailable');
  const customer = await own.table('stripe_customers').where('stripe_customer_external_id', purchase.customer_id).first('stripe_customer_id');
  if (!customer) throw new Error('Independent billing customer is missing');
  await own.table('stripe_products').insert({ tenant, stripe_product_external_id: product.id, name: product.name,
    product_type: 'license', metadata: product.metadata }).onConflict(['tenant', 'stripe_product_external_id']).ignore();
  const productRow = await own.table('stripe_products').where('stripe_product_external_id', product.id).first('stripe_product_id');
  await own.table('stripe_prices').insert({ tenant, stripe_price_external_id: price.id, stripe_product_id: productRow.stripe_product_id,
    unit_amount: price.unit_amount, currency: price.currency, billing_interval: price.recurring?.interval,
    interval_count: price.recurring?.interval_count, metadata: price.metadata }).onConflict(['tenant', 'stripe_price_external_id']).ignore();
  const priceRow = await own.table('stripe_prices').where('stripe_price_external_id', price.id).first('stripe_price_id');
  const end = (subscription as Stripe.Subscription & { current_period_end?: number }).current_period_end ?? item.current_period_end;
  await own.table('stripe_subscriptions').insert({ tenant, stripe_subscription_external_id: subscription.id,
    stripe_customer_id: customer.stripe_customer_id, stripe_price_id: priceRow.stripe_price_id,
    stripe_subscription_item_id: item.id, quantity: item.quantity, status: subscription.status,
    current_period_end: validUntil ?? (end ? new Date(end * 1000) : null), metadata: subscription.metadata,
    updated_at: trx.fn.now() }).onConflict(['tenant', 'stripe_subscription_external_id']).merge();
}

/** A verified webhook or an admitted customer can reconcile the same durable
 * operation. This stores paid billing only; conversion requires the separate
 * customer-confirmed upgrade command and never borrows webhook authority. */
export async function reconcileCoManagedUpgradeCheckout(db: Knex, stripe: Stripe, tenant: string, operationId: string, sessionId: string) {
  const purchase = await operation(db, tenant, operationId);
  if (purchase.state === 'paid') {
    if (purchase.checkout_session_id !== sessionId) throw new Error('Checkout identity changed');
    return { kind: 'paid' as const };
  }
  const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ['line_items.data.price'] });
  assertSession(session, purchase);
  let paid: ReturnType<typeof paidPsaUpgradeFromStripe> | undefined;
  let subscription: Stripe.Subscription | undefined;
  if (session.status === 'complete' && ['paid', 'no_payment_required'].includes(session.payment_status)) {
    const subscriptionId = id(session.subscription);
    if (!subscriptionId) throw new Error('Paid checkout has no subscription');
    const customer = await stripe.customers.retrieve(purchase.customer_id!);
    subscription = await stripe.subscriptions.retrieve(subscriptionId, { expand: ['latest_invoice', 'items.data.price.product'] });
    if (!matches(subscription.metadata, purchase)) throw new Error('Subscription does not match the independent purchase');
    const item = subscription.items.data[0];
    const end = (subscription as Stripe.Subscription & { current_period_end?: number }).current_period_end ?? item?.current_period_end;
    paid = paidPsaUpgradeFromStripe({ tenant, subscriptionId, customerId: purchase.customer_id!, itemId: item?.id,
      priceId: purchase.price_id, seats: purchase.quantity, validUntil: new Date((end ?? 0) * 1000).toISOString(), fingerprint: '' },
      customer, subscription, { [purchase.billing_interval]: purchase.price_id });
  }
  const kind = paid ? 'paid' : session.status === 'expired' ? 'expired' : session.status === 'complete' ? 'processing' : 'checkout';
  await db.transaction(async trx => {
    const current = await retainOperation(trx, tenant, operationId), own = tenantDb(trx, tenant);
    if (current.state === 'paid') return;
    if (current.customer_id !== purchase.customer_id || (current.checkout_session_id && current.checkout_session_id !== sessionId)) throw new Error('Purchase changed during provider verification');
    if (paid && subscription) await storeUpgradeSubscription(trx, purchase, subscription, paid.validUntil);
    await own.table('co_managed_upgrade_purchases').where('operation_id', operationId).update({ checkout_session_id: sessionId,
      subscription_id: paid?.reference ?? id(session.subscription) ?? current.subscription_id, state: kind === 'processing' ? 'checkout' : kind,
      updated_at: trx.fn.now() });
  });
  return kind === 'checkout' ? { kind, clientSecret: session.client_secret } : { kind };
}

export async function purchaseCoManagedIndependentPsa(db: Knex, inputActor: CoManagedSessionActor, input: CoManagedUpgradePurchaseRequest,
  dependencies?: { stripe: Stripe; publishableKey: string; priceId: string; returnBaseUrl: string }): Promise<IndependentCheckoutResult> {
  const actor = { ...inputActor }, request = { ...input };
  const configuredPrice = request.interval === 'year'
    ? process.env.STRIPE_ALGAPSA_USER_ANNUAL_PRICE_ID || process.env.STRIPE_PRO_ANNUAL_PRICE_ID
    : process.env.STRIPE_ALGAPSA_USER_PRICE_ID || process.env.STRIPE_PRO_PRICE_ID;
  const purchase = await prepareCoManagedUpgradePurchase(db, actor, request, dependencies?.priceId ?? configuredPrice ?? '');
  if (purchase.state === 'paid' || purchase.state === 'expired') return { kind: purchase.state };
  const provider = dependencies ?? { ...await independentCheckoutStripeContext(),
    returnBaseUrl: (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || 'https://localhost:3000').replace(/^http:\/\//, 'https://'), priceId: configuredPrice! };
  const { stripe } = provider;
  const info = await withCoManagedUpgradePurchaseAdmin(db, actor, async trx => {
    const own = tenantDb(trx, actor.tenant), tenant = await own.table('tenants').first('client_name', 'email', 'product_code');
    if (tenant.product_code !== 'co_managed') throw new Error('This workspace has already upgraded');
    const customers = await own.table('stripe_customers').select('stripe_customer_external_id');
    if (customers.length > 1) throw new Error('Ambiguous workspace billing customer');
    return { name: tenant.client_name as string, email: tenant.email as string, externalId: customers[0]?.stripe_customer_external_id as string | undefined };
  });
  const customer = await resolveCustomer(stripe, purchase, info);
  await withCoManagedUpgradePurchaseAdmin(db, actor, trx => saveCustomer(trx, purchase, customer));
  purchase.customer_id = customer.id;
  let sessionId = purchase.checkout_session_id;
  if (!sessionId) {
    sessionId = await findCheckoutSession(stripe, purchase);
    if (!sessionId) {
      if (Date.now() - new Date(purchase.created_at).getTime() > 23 * 3600000) throw new Error('The pending purchase needs provider reconciliation');
      const price = await stripe.prices.retrieve(purchase.price_id);
      if (!price.active || price.type !== 'recurring' || price.recurring?.interval !== purchase.billing_interval ||
          price.recurring.interval_count !== 1 || price.recurring.usage_type !== 'licensed' || !price.unit_amount || price.unit_amount < 0)
        throw new Error('Configured PSA seat price is unavailable');
      const session = await stripe.checkout.sessions.create({ mode: 'subscription', ui_mode: 'embedded', redirect_on_completion: 'if_required',
        customer: customer.id, client_reference_id: actor.tenant, metadata: metadata(purchase),
        subscription_data: { metadata: metadata(purchase) }, line_items: [{ price: purchase.price_id, quantity: purchase.quantity }],
        return_url: `${provider.returnBaseUrl}/msp/co-management/upgrade` }, { idempotencyKey: `co-upgrade-checkout:${actor.tenant}:${purchase.operation_id}` });
      sessionId = session.id;
    }
  }
  const result = await reconcileCoManagedUpgradeCheckout(db, stripe, actor.tenant, purchase.operation_id, sessionId);
  return withCoManagedUpgradePurchaseAdmin(db, actor, async () => {
    if (result.kind === 'checkout') {
      if (!result.clientSecret) throw new Error('Checkout credentials are unavailable');
      return { kind: 'checkout' as const, clientSecret: result.clientSecret, publishableKey: provider.publishableKey };
    }
    return { kind: result.kind };
  });
}

/** Called only after the existing Stripe webhook signature and tenant routing
 * checks. Payment events can finish recording an authorized purchase even when
 * the customer has closed the browser; they cannot convert the workspace. */
export async function handleCoManagedUpgradePaymentEvent(db: Knex, stripe: Stripe, tenant: string, event: Stripe.Event): Promise<boolean> {
  const relevant = ['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.expired',
    'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted', 'invoice.paid', 'invoice.payment_failed'];
  if (!relevant.includes(event.type)) return false;
  let value = event.data.object as any;
  if (event.type.startsWith('invoice.')) {
    const subscriptionId = id(value.subscription ?? value.parent?.subscription_details?.subscription);
    if (!subscriptionId) return false;
    const own = tenantDb(db, tenant);
    if ((await own.table('tenants').first('product_code'))?.product_code !== 'co_managed' ||
        !await own.table('co_managed_upgrade_purchases').where('subscription_id', subscriptionId).first('operation_id')) return false;
    value = await stripe.subscriptions.retrieve(subscriptionId);
  }
  if (value.metadata?.source !== INDEPENDENT_UPGRADE_SOURCE) return false;
  const own = tenantDb(db, tenant), owner = await own.table('tenants').first('product_code');
  // After conversion, normal PSA subscription webhooks maintain renewals/seats.
  if (owner?.product_code === 'psa' && !event.type.startsWith('checkout.')) return false;
  const purchase = await operation(db, tenant, value.metadata.operation_id);
  if (!matches(value.metadata, purchase) || id(value.customer) !== purchase.customer_id) throw new Error('Payment event does not match the authorized independent purchase');
  if (event.type === 'customer.subscription.deleted' && purchase.state !== 'paid') {
    const current = await stripe.subscriptions.retrieve(value.id, { expand: ['items.data.price.product'] });
    if (!matches(current.metadata, purchase) || id(current.customer) !== purchase.customer_id) throw new Error('Independent subscription ownership changed');
    if (current.status !== 'canceled') return true; // Ignore an obsolete cancellation event.
    const sessionId = await findCheckoutSession(stripe, purchase);
    if (!sessionId) throw new Error('Canceled checkout requires provider reconciliation');
    const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ['line_items.data.price'] });
    assertSession(session, purchase);
    if (id(session.subscription) !== current.id) throw new Error('Canceled subscription does not belong to this checkout');
    return db.transaction(async trx => {
      const retained = await retainOperation(trx, tenant, purchase.operation_id), owner = tenantDb(trx, tenant);
      if ((await owner.table('tenants').first('product_code'))?.product_code !== 'co_managed') return false;
      await storeUpgradeSubscription(trx, retained, current);
      await owner.table('co_managed_upgrade_purchases').where('operation_id', purchase.operation_id).update({
        checkout_session_id: sessionId, subscription_id: current.id, state: retained.state === 'paid' ? 'paid' : 'expired', updated_at: trx.fn.now() });
      return true;
    });
  }
  if (purchase.state === 'paid' && !event.type.startsWith('checkout.')) {
    const current = await stripe.subscriptions.retrieve(value.id, { expand: ['items.data.price.product'] });
    if (current.id !== purchase.subscription_id || !matches(current.metadata, purchase) || id(current.customer) !== purchase.customer_id)
      throw new Error('Independent subscription ownership changed');
    return db.transaction(async trx => {
      const retained = await retainOperation(trx, tenant, purchase.operation_id);
      if ((await tenantDb(trx, tenant).table('tenants').first('product_code'))?.product_code !== 'co_managed') return false;
      if (retained.subscription_id !== current.id || retained.customer_id !== purchase.customer_id) throw new Error('Independent subscription changed');
      await storeUpgradeSubscription(trx, retained, current);
      return true;
    });
  }
  const sessionId = event.type.startsWith('checkout.') ? value.id : await findCheckoutSession(stripe, purchase);
  if (!sessionId) throw new Error('Independent checkout is not visible yet; retry payment reconciliation');
  await reconcileCoManagedUpgradeCheckout(db, stripe, tenant, purchase.operation_id, sessionId);
  return true;
}
