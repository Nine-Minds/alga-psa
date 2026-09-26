import { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { getConnection } from 'server/src/lib/db/db';
import { v4 as uuidv4 } from 'uuid';
import { createStripePaymentProvider } from './StripePaymentProvider';
import { resolveInvoiceBillingRecipient } from '@alga-psa/billing/services';

/** EE-owned bridge between hosted Stripe setup and profile-scoped payment_methods. */
export class SavedPaymentMethodService {
  private constructor(private readonly tenantId: string, private readonly knex: Knex) {}

  static async create(tenantId: string): Promise<SavedPaymentMethodService> {
    return new SavedPaymentMethodService(tenantId, await getConnection());
  }

  async startSetup(clientId: string, billingProfileId: string, returnTo?: string): Promise<{ externalSessionId: string; url: string }> {
    const profile = await tenantDb(this.knex, this.tenantId).table('client_billing_profiles')
      .where({ client_id: clientId, billing_profile_id: billingProfileId, is_active: true }).first();
    if (!profile) throw new Error('Billing profile is unavailable');
    const recipient = await resolveInvoiceBillingRecipient({ knexOrTrx: this.knex, tenantId: this.tenantId, clientId });
    if (!recipient.clientName) throw new Error('Client is unavailable');
    const client = await tenantDb(this.knex, this.tenantId).table('clients').where({ client_id: clientId }).first('default_currency_code');
    const provider = createStripePaymentProvider(this.tenantId);
    const customerId = await provider.getOrCreateCustomer(clientId, recipient.recipientEmail, String(profile.name ?? recipient.clientName), billingProfileId);
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL;
    if (!baseUrl) throw new Error('Application base URL is not configured');
    const safeReturnTo = returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/client-portal/billing';
    const currency = String(profile.currency_code ?? profile.currency ?? client?.default_currency_code ?? process.env.DEFAULT_CURRENCY ?? '').toLowerCase();
    if (!currency) throw new Error('Billing currency is not configured for this client');
    const session = await provider.createPaymentMethodSetupSession({ clientId, billingProfileId, customerId, currency,
      successUrl: `${baseUrl}/client-portal/billing/payment-methods/setup-complete?session_id={CHECKOUT_SESSION_ID}&returnTo=${encodeURIComponent(safeReturnTo)}`,
      cancelUrl: `${baseUrl}${safeReturnTo}` });
    return session;
  }

  async completeSetup(externalSessionOrSetupIntentId: string): Promise<{ paymentMethodId: string }> {
    const stripe = createStripePaymentProvider(this.tenantId);
    const eventObject = await this.inspectSetup(externalSessionOrSetupIntentId);
    const clientId = eventObject.clientId;
    const billingProfileId = eventObject.billingProfileId;
    const paymentMethodExternalId = eventObject.paymentMethodId;
    if (!paymentMethodExternalId) throw new Error('Stripe setup intent has no payment method');
    const details = await stripe.retrieveSavedPaymentMethod(paymentMethodExternalId);
    await stripe.updateSavedPaymentMethodMetadata(paymentMethodExternalId, { tenant_id: this.tenantId, client_id: clientId, billing_profile_id: billingProfileId });
    const profile = await tenantDb(this.knex, this.tenantId).table('client_billing_profiles')
      .where({ client_id: clientId, billing_profile_id: billingProfileId }).first();
    if (!profile) throw new Error('Billing profile for setup intent no longer exists');

    return this.knex.transaction(async (trx) => {
      const profileRow = await tenantDb(trx, this.tenantId).table('client_billing_profiles')
        .where({ client_id: clientId, billing_profile_id: billingProfileId }).forUpdate().first();
      if (!profileRow) throw new Error('Billing profile for setup intent no longer exists');
      const existing = await tenantDb(trx, this.tenantId).table('payment_methods')
        .where({ provider_type: 'stripe', external_payment_method_id: paymentMethodExternalId }).first();
      if (existing) return { paymentMethodId: String(existing.payment_method_id) };
      const paymentMethodId = uuidv4();
      const hasDefault = await tenantDb(trx, this.tenantId).table('payment_methods')
        .where({ billing_profile_id: billingProfileId, is_default: true, is_deleted: false }).first();
      const row = {
        tenant: this.tenantId, payment_method_id: paymentMethodId, client_id: clientId, billing_profile_id: billingProfileId,
        type: 'credit_card', last4: details.last4, exp_month: String(details.expMonth), exp_year: String(details.expYear),
        is_default: !hasDefault, is_deleted: false, provider_type: 'stripe', external_payment_method_id: details.externalPaymentMethodId,
        external_customer_id: details.externalCustomerId, brand: details.brand, fingerprint: details.fingerprint, status: 'active',
        created_at: trx.fn.now(), updated_at: trx.fn.now(),
      };
      const [inserted] = await tenantDb(trx, this.tenantId).table('payment_methods').insert(row).returning('payment_method_id');
      return { paymentMethodId: String(inserted.payment_method_id) };
    });
  }

  async inspectSetup(externalSessionOrSetupIntentId: string): Promise<{ clientId: string; billingProfileId: string; tenantId: string; status: string; paymentMethodId: string | null }> {
    const stripe = createStripePaymentProvider(this.tenantId);
    const setupIntent = externalSessionOrSetupIntentId.startsWith('cs_')
      ? await stripe.getSetupIntentFromCheckout(externalSessionOrSetupIntentId)
      : await stripe.getSetupIntent(externalSessionOrSetupIntentId);
    if (setupIntent.status !== 'succeeded') throw new Error(`Stripe SetupIntent is not complete (status: ${setupIntent.status})`);
    const metadata = setupIntent.metadata;
    if (!metadata?.client_id || !metadata?.billing_profile_id || metadata?.tenant_id !== this.tenantId) {
      throw new Error('Stripe setup metadata is incomplete or belongs to another tenant');
    }
    const paymentMethodId = typeof setupIntent.payment_method === 'string' ? setupIntent.payment_method : setupIntent.payment_method?.id ?? null;
    return { clientId: metadata.client_id, billingProfileId: metadata.billing_profile_id, tenantId: this.tenantId, status: setupIntent.status, paymentMethodId };
  }

  async removeMethod(paymentMethodId: string): Promise<void> {
    const method = await tenantDb(this.knex, this.tenantId).table('payment_methods').where({ payment_method_id: paymentMethodId }).first();
    if (!method) throw new Error('Payment method not found');
    if (method.provider_type === 'stripe' && method.external_payment_method_id) await createStripePaymentProvider(this.tenantId).detachPaymentMethod(method.external_payment_method_id);
    await tenantDb(this.knex, this.tenantId).table('payment_methods').where({ payment_method_id: paymentMethodId }).update({ is_deleted: true, is_default: false, status: 'detached', updated_at: this.knex.fn.now() });
    await tenantDb(this.knex, this.tenantId).table('billing_profile_autopay').where({ payment_method_id: paymentMethodId, is_enabled: true }).update({ is_enabled: false, disabled_at: this.knex.fn.now(), disabled_reason: 'payment_method_removed', updated_at: this.knex.fn.now() });
  }

  async syncFromProviderEvent(event: { eventType: string; externalPaymentMethodId?: string }): Promise<void> {
    if (!event.externalPaymentMethodId) return;
    const method = await tenantDb(this.knex, this.tenantId).table('payment_methods')
      .where({ provider_type: 'stripe', external_payment_method_id: event.externalPaymentMethodId }).first();
    if (!method) return;
    if (event.eventType === 'payment_method.detached') {
      await tenantDb(this.knex, this.tenantId).table('payment_methods').where({ payment_method_id: method.payment_method_id })
        .update({ status: 'detached', is_deleted: true, is_default: false, updated_at: this.knex.fn.now() });
      await tenantDb(this.knex, this.tenantId).table('billing_profile_autopay').where({ payment_method_id: method.payment_method_id, is_enabled: true })
        .update({ is_enabled: false, disabled_at: this.knex.fn.now(), disabled_reason: 'payment_method_detached', updated_at: this.knex.fn.now() });
      return;
    }
    try {
      const details = await createStripePaymentProvider(this.tenantId).retrieveSavedPaymentMethod(event.externalPaymentMethodId);
      await tenantDb(this.knex, this.tenantId).table('payment_methods').where({ payment_method_id: method.payment_method_id }).update({
        brand: details.brand, last4: details.last4, exp_month: String(details.expMonth), exp_year: String(details.expYear), fingerprint: details.fingerprint,
        status: 'active', updated_at: this.knex.fn.now(),
      });
    } catch {
      await tenantDb(this.knex, this.tenantId).table('payment_methods').where({ payment_method_id: method.payment_method_id })
        .update({ status: 'requires_update', updated_at: this.knex.fn.now() });
    }
  }
}
