import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';
import { getConnection } from 'server/src/lib/db/db';
import { computeBalanceDue } from '@alga-psa/billing/services/accountingSync/recordExternalPayment';
import { PaymentService } from './PaymentService';
import { createStripePaymentProvider } from './StripePaymentProvider';
import { classifyAutopayFailure, isAutopayEnrollmentValid, resolveConsentTextVersion, retryAt, shouldScheduleAutopay } from './autopayPolicy';
import type { PaymentWebhookEvent } from '@alga-psa/types';
import { buildPaymentFailedPayload } from 'server/src/lib/api/services/paymentWorkflowEvents';
import { publishWorkflowEvent } from 'server/src/lib/eventBus/publishers';
import logger from '@alga-psa/core/logger';
import { reconcileStripeWebhookEvents } from './stripeWebhookEvents';
import { startInvoiceAutopay, signalInvoiceAutopay, signalProfileAutopayChanged } from '../temporal/invoiceAutopay';
import { getSystemEmailService } from '@alga-psa/email';
import { resolveInvoiceBillingRecipient } from '@alga-psa/billing/services';

type Authorization = { userId: string | null; source: 'client_portal' | 'msp'; ip?: string | null; userAgent?: string | null; consentTextVersion: string };

export class AutopayService {

  private constructor(private readonly tenantId: string, private readonly knex: Knex) {}
  static async create(tenantId: string): Promise<AutopayService> { return new AutopayService(tenantId, await getConnection()); }
  static async startInvoiceAutopay(tenantId: string, invoiceId: string): Promise<void> {
    await startInvoiceAutopay(tenantId, invoiceId);
  }
  static async signalInvoiceSettled(tenantId: string, invoiceId: string): Promise<void> {
    await signalInvoiceAutopay(tenantId, invoiceId, 'invoiceSettled');
  }
  static async chargeInvoiceNow(tenantId: string, invoiceId: string): Promise<void> {
    await startInvoiceAutopay(tenantId, invoiceId);
    await signalInvoiceAutopay(tenantId, invoiceId, 'chargeNow');
  }
  private table(name: string): Knex.QueryBuilder<any, any> { return tenantDb(this.knex, this.tenantId).table(name); }

  async enroll(billingProfileId: string, paymentMethodId: string, authorization: Authorization): Promise<void> {
    const config = await this.table('payment_provider_configs').where({ provider_type: 'stripe', is_enabled: true }).first();
    const settings = (config?.settings ?? {}) as Record<string, unknown>;
    const method = await this.table('payment_methods').where({ payment_method_id: paymentMethodId, billing_profile_id: billingProfileId, is_deleted: false }).first();
    if (!isAutopayEnrollmentValid({ tenantEnabled: settings.autopayEnabled === true, profileMatches: method?.billing_profile_id === billingProfileId,
      providerType: method?.provider_type, status: method?.status, externalPaymentMethodId: method?.external_payment_method_id, externalCustomerId: method?.external_customer_id })) {
      throw new Error(settings.autopayEnabled !== true ? 'Auto-pay is disabled for this tenant' : 'Selected card is not chargeable for this billing profile');
    }
    const consentTextVersion = resolveConsentTextVersion({ source: authorization.source, submittedVersion: authorization.consentTextVersion,
      currentVersion: settings.autopayConsentTextVersion as string | undefined });
    const profile = await this.table('client_billing_profiles').where({ billing_profile_id: billingProfileId }).first();
    if (!profile) throw new Error('Billing profile not found');
    await reconcileStripeWebhookEvents(this.tenantId);
    await this.table('billing_profile_autopay').insert({ tenant: this.tenantId, billing_profile_id: billingProfileId, client_id: profile.client_id,
      is_enabled: true, payment_method_id: paymentMethodId, authorized_at: this.knex.fn.now(), authorized_by_user_id: authorization.userId,
      authorization_source: authorization.source, authorization_ip: authorization.ip ?? null, authorization_user_agent: authorization.userAgent ?? null,
      consent_text_version: consentTextVersion, disabled_at: null, disabled_by_user_id: null, disabled_reason: null,
      created_at: this.knex.fn.now(), updated_at: this.knex.fn.now() })
      .onConflict(['tenant', 'billing_profile_id']).merge();
    await signalProfileAutopayChanged(this.knex, this.tenantId, billingProfileId);
  }

  async getProfileOverview(billingProfileId: string): Promise<Record<string, unknown> | null> {
    const profile = await this.table('client_billing_profiles').where({ billing_profile_id: billingProfileId }).first('client_id');
    if (!profile) return null;
    const [config, enrollment, methods, attempts] = await Promise.all([
      this.table('payment_provider_configs').where({ provider_type: 'stripe', is_enabled: true }).first('settings'),
      this.table('billing_profile_autopay').where({ billing_profile_id: billingProfileId }).first(),
      this.table('payment_methods').where({ billing_profile_id: billingProfileId, provider_type: 'stripe', is_deleted: false }).select('payment_method_id', 'brand', 'last4', 'exp_month', 'exp_year', 'status', 'external_payment_method_id'),
      this.table('invoice_autopay_attempts').where({ billing_profile_id: billingProfileId }).orderBy('created_at', 'desc').limit(5),
    ]);
    let authorizedBy: string | null = null;
    if (enrollment?.authorized_by_user_id) {
      const author = await this.table('users').where({ user_id: enrollment.authorized_by_user_id }).first('first_name', 'last_name', 'email');
      authorizedBy = [author?.first_name, author?.last_name].filter(Boolean).join(' ').trim() || author?.email || 'Unknown user';
    }
    const safeMethods = methods.map(({ external_payment_method_id: _externalId, ...method }: any) => method);
    const chargeableMethodIds = new Set(methods.filter((method: any) => method.status === 'active' && !!method.external_payment_method_id).map((method: any) => method.payment_method_id));
    return { enabled: (config?.settings as any)?.autopayEnabled === true, consentText: (config?.settings as any)?.autopayConsentText ?? '',
      consentTextVersion: (config?.settings as any)?.autopayConsentTextVersion ?? '1', enrollment: enrollment ? { ...enrollment, authorized_by_display_name: authorizedBy } : null,
      methods: safeMethods,
      chargeableMethods: safeMethods.filter((method: any) => chargeableMethodIds.has(method.payment_method_id)), attempts };
  }

  async getInvoiceAutopayContexts(invoiceIds: string[]): Promise<Record<string, { scheduledFor: string; brand: string | null; last4: string; status: string }>> {
    if (invoiceIds.length === 0) return {};
    const rows = await this.table('invoice_autopay_attempts as aa')
      .join('payment_methods as pm', function () {
        this.on('pm.payment_method_id', '=', 'aa.payment_method_id').andOn('pm.tenant', '=', 'aa.tenant');
      })
      .join('billing_profile_autopay as bpa', function () {
        this.on('bpa.tenant', '=', 'aa.tenant').andOn('bpa.billing_profile_id', '=', 'aa.billing_profile_id');
      })
      .where('bpa.is_enabled', true).where('bpa.payment_method_id', this.knex.ref('aa.payment_method_id'))
      .where('pm.status', 'active').where('pm.is_deleted', false)
      .whereIn('aa.invoice_id', invoiceIds).where(function () {
        this.where('aa.status', 'processing').orWhere(function () {
          this.where('aa.status', 'scheduled').whereRaw('aa.scheduled_for >= now()');
        });
      })
      .select('aa.invoice_id', 'aa.scheduled_for', 'aa.status', 'pm.brand', 'pm.last4').orderBy('aa.scheduled_for', 'asc');
    const result: Record<string, { scheduledFor: string; brand: string | null; last4: string; status: string }> = {};
    for (const row of rows) result[row.invoice_id] ??= { scheduledFor: row.status === 'processing' ? new Date().toISOString() : row.scheduled_for, brand: row.brand, last4: row.last4, status: row.status };
    return result;
  }

  async disenroll(billingProfileId: string, reason: string, actor: string | null): Promise<void> {
    await this.table('billing_profile_autopay').where({ billing_profile_id: billingProfileId, is_enabled: true }).update({ is_enabled: false,
      disabled_at: this.knex.fn.now(), disabled_by_user_id: actor, disabled_reason: reason, updated_at: this.knex.fn.now() });
    await signalProfileAutopayChanged(this.knex, this.tenantId, billingProfileId);
  }

  async handleProviderEvent(event: PaymentWebhookEvent): Promise<void> {
    if (!event.autopayAttemptId) return;
    const attempt = await this.table('invoice_autopay_attempts').where({ attempt_id: event.autopayAttemptId }).first();
    if (!attempt) return;
    if (attempt.status !== 'processing') return;
    if (event.eventType === 'payment_intent.succeeded') {
      const updated = await this.table('invoice_autopay_attempts').where({ attempt_id: event.autopayAttemptId, status: 'processing' }).update({ status: 'succeeded',
        payment_intent_id: event.paymentIntentId, processed_at: this.knex.fn.now(), updated_at: this.knex.fn.now() });
      if (updated !== 1) return;
      await signalInvoiceAutopay(this.tenantId, attempt.invoice_id, 'paymentIntentSettled', { attemptId: attempt.attempt_id, status: 'succeeded' });
      return;
    }
    if (event.eventType === 'payment_intent.payment_failed') {
      const raw = event.payload as any;
      const intent = raw?.data?.object ?? {};
      const error = intent.last_payment_error ?? {};
      await this.failAttempt(attempt, { status: error.code === 'authentication_required' ? 'requires_action' : 'failed',
        paymentIntentId: event.paymentIntentId ?? intent.id, failureCode: error.code, declineCode: error.decline_code, message: error.message });
      await signalInvoiceAutopay(this.tenantId, attempt.invoice_id, 'paymentIntentSettled', { attemptId: attempt.attempt_id, status: 'payment_failed' });
    }
  }

  async prepareInvoiceAutopay(invoiceId: string): Promise<{ status: 'skip'; reason: string } | { attemptId: string; scheduledFor: string; processingStartedAt?: string }> {
    const invoice = await this.table('invoices').where({ invoice_id: invoiceId }).first();
    const open = await this.table('invoice_autopay_attempts').where({ invoice_id: invoiceId }).whereIn('status', ['scheduled', 'processing']).first();
    if (open) {
      if (!invoice) throw new Error(`Invoice ${invoiceId} not found`);
      return { attemptId: open.attempt_id, scheduledFor: new Date(open.scheduled_for).toISOString(),
        processingStartedAt: open.status === 'processing' ? new Date(open.updated_at).toISOString() : undefined };
    }
    if (!invoice || invoice.status !== 'sent' || invoice.invoice_type === 'credit_note') return { status: 'skip', reason: 'invoice_ineligible' };
    const profileId = invoice.billing_profile_id ?? (await this.table('client_billing_profiles').where({ client_id: invoice.client_id, is_default: true }).first())?.billing_profile_id;
    if (!profileId) return { status: 'skip', reason: 'no_billing_profile' };
    const [config, enrollment, payments] = await Promise.all([
      this.table('payment_provider_configs').where({ provider_type: 'stripe', is_enabled: true }).first(),
      this.table('billing_profile_autopay').where({ billing_profile_id: profileId, is_enabled: true }).first(),
      this.table('invoice_payments').where({ invoice_id: invoiceId }).sum('amount as total').first(),
    ]);
    const settings = (config?.settings ?? {}) as Record<string, any>;
    if (settings.autopayEnabled !== true || !enrollment) return { status: 'skip', reason: 'not_enrolled' };
    const method = await this.table('payment_methods').where({ payment_method_id: enrollment.payment_method_id, billing_profile_id: profileId,
      provider_type: 'stripe', status: 'active', is_deleted: false }).first();
    if (!method?.external_payment_method_id || !method.external_customer_id) return { status: 'skip', reason: 'no_chargeable_method' };
    const amount = computeBalanceDue({ totalAmount: Number(invoice.total_amount), creditApplied: Number(invoice.credit_applied ?? 0), totalPaid: Number(payments?.total ?? 0) });
    const currency = String(invoice.currency_code ?? 'USD').toUpperCase();
    if (!shouldScheduleAutopay({ invoiceExists: true, finalized: invoice.status === 'sent', creditNote: invoice.invoice_type === 'credit_note',
      tenantEnabled: settings.autopayEnabled === true, enrolled: !!enrollment, chargeableMethod: !!method?.external_payment_method_id && !!method?.external_customer_id,
      providerEnabled: !!config, balanceCents: amount, currencySupported: currency.length === 3 && createStripePaymentProvider(this.tenantId).capabilities().supportedCurrencies.includes(currency),
      hasOpenAttempt: !!open })) {
      return { status: 'skip', reason: 'invoice_ineligible' };
    }
    const attemptId = uuidv4();
    const dueDate = settings.autopayChargeTiming === 'on_due_date' ? new Date(invoice.due_date ?? Date.now()) : new Date();
    await this.table('invoice_autopay_attempts').insert({ tenant: this.tenantId, attempt_id: attemptId, invoice_id: invoiceId, billing_profile_id: profileId,
      payment_method_id: method.payment_method_id, attempt_number: 1, scheduled_for: dueDate, status: 'scheduled', amount, currency,
      provider_type: 'stripe', payment_intent_id: null, idempotency_key: `autopay:${this.tenantId}:${invoiceId}:${attemptId}`,
      failure_code: null, failure_message: null, decline_code: null, created_at: this.knex.fn.now(), updated_at: this.knex.fn.now() });
    return { attemptId, scheduledFor: dueDate.toISOString() };
  }
  async executeAttempt(attemptId: string): Promise<{ status: 'succeeded' | 'processing' | 'failed' | 'requires_action' | 'cancelled'; retryAt?: string | null; hard?: boolean; processingStartedAt?: string }> {
    let attempt = await this.table('invoice_autopay_attempts').where({ attempt_id: attemptId }).first();
    if (!attempt) throw new Error(`Auto-pay attempt ${attemptId} does not exist`);
    if (attempt.status === 'failed' || attempt.status === 'requires_action') return this.reconcileAttempt(attemptId);
    if (!['scheduled', 'processing'].includes(attempt.status)) return { status: attempt.status === 'succeeded' ? 'succeeded' : 'cancelled' };
    if (attempt.status === 'scheduled') {
      const claimed = await this.table('invoice_autopay_attempts').where({ attempt_id: attemptId, status: 'scheduled' })
        .update({ status: 'processing', updated_at: this.knex.fn.now() });
      attempt = await this.table('invoice_autopay_attempts').where({ attempt_id: attemptId }).first();
      if (claimed !== 1 && attempt?.status !== 'processing') return { status: attempt?.status === 'succeeded' ? 'succeeded' : 'cancelled' };
    }
    const invoice = await this.table('invoices').where({ invoice_id: attempt.invoice_id }).first();
    if (!invoice) throw new Error(`Invoice ${attempt.invoice_id} not found`);
    if (['paid', 'cancelled', 'void'].includes(invoice.status)) { await this.cancelAttempt(attemptId); return { status: 'cancelled' }; }
    const config = await this.table('payment_provider_configs').where({ provider_type: 'stripe', is_enabled: true }).first();
    if (!config) throw new Error('Auto-pay is not configured for this tenant');
    const settings = (config?.settings ?? {}) as Record<string, any>;
    const enrollment = settings.autopayEnabled === true ? await this.table('billing_profile_autopay').where({ billing_profile_id: attempt.billing_profile_id, is_enabled: true }).first() : null;
    const method = enrollment ? await this.table('payment_methods').where({ payment_method_id: enrollment.payment_method_id, billing_profile_id: attempt.billing_profile_id, is_deleted: false, status: 'active' }).first() : null;
    if (!method?.external_payment_method_id || !method.external_customer_id) { await this.cancelAttempt(attemptId); return { status: 'cancelled' }; }
    await this.table('invoice_autopay_attempts').where({ attempt_id: attemptId, status: 'processing' }).update({ payment_method_id: method.payment_method_id });
    attempt.payment_method_id = method.payment_method_id;
    const payments = await this.table('invoice_payments').where({ invoice_id: attempt.invoice_id }).sum('amount as total').first();
    const amount = computeBalanceDue({ totalAmount: Number(invoice.total_amount), creditApplied: Number(invoice.credit_applied ?? 0), totalPaid: Number(payments?.total ?? 0) });
    if (amount <= 0) { await this.cancelAttempt(attemptId); return { status: 'cancelled' }; }
    const paymentService = await PaymentService.create(this.tenantId);
    // A live Checkout link is retired before the charge; failure leaves this attempt processing for reconciliation.
    await paymentService.expireActiveLinksForInvoice(attempt.invoice_id, 'stale_balance');
    let result;
    if (Date.now() - new Date(attempt.updated_at).getTime() >= 24 * 60 * 60 * 1000) {
      const existingIntent = await createStripePaymentProvider(this.tenantId).retrieveAttemptPaymentIntent(attempt.attempt_id);
      if (!existingIntent) return { status: 'processing', processingStartedAt: new Date(attempt.updated_at).toISOString() };
      if (existingIntent.status === 'succeeded') {
        const landed = await paymentService.recordAutoPaySuccess({ invoiceId: attempt.invoice_id,
          amount: Number(existingIntent.amount_received || existingIntent.amount), currency: attempt.currency,
          paymentIntentId: existingIntent.id, attemptId: attempt.attempt_id });
        if (!landed.success) throw new Error(landed.error ?? 'Unable to record auto-pay payment');
        await this.table('invoice_autopay_attempts').where({ attempt_id: attempt.attempt_id, status: 'processing' }).update({ status: 'succeeded', payment_intent_id: existingIntent.id, processed_at: this.knex.fn.now(), updated_at: this.knex.fn.now() });
        return { status: 'succeeded' };
      }
      if (existingIntent.status === 'requires_payment_method' || existingIntent.status === 'canceled') {
        return this.failAttempt(attempt, { status: 'failed', paymentIntentId: existingIntent.id,
          failureCode: existingIntent.last_payment_error?.code, declineCode: existingIntent.last_payment_error?.decline_code,
          message: existingIntent.last_payment_error?.message });
      }
      return { status: 'processing', processingStartedAt: new Date(attempt.updated_at).toISOString() };
    }
    try {
      result = await createStripePaymentProvider(this.tenantId).chargeSavedPaymentMethod!({ amount, currency: attempt.currency,
      customerId: method.external_customer_id, paymentMethodId: method.external_payment_method_id, invoiceId: attempt.invoice_id,
      clientId: invoice.client_id, billingProfileId: attempt.billing_profile_id, attemptId: attempt.attempt_id,
      idempotencyKey: attempt.idempotency_key, description: `Invoice ${invoice.invoice_number ?? attempt.invoice_id}` });
    } catch (error) {
      // Stripe may have accepted the request before the connection failed. Leave processing for intent lookup; never charge blindly.
      logger.error('[AutopayService] Stripe charge response was lost; attempt left processing for recovery', { tenantId: this.tenantId, attemptId: attempt.attempt_id, error });
      return { status: 'processing', processingStartedAt: new Date(attempt.updated_at).toISOString() };
    }
    if (result.status === 'succeeded') {
      const landed = await paymentService.recordAutoPaySuccess({ invoiceId: attempt.invoice_id, amount, currency: attempt.currency,
        paymentIntentId: result.paymentIntentId, attemptId: attempt.attempt_id });
      if (!landed.success) throw new Error(landed.error ?? 'Unable to record auto-pay payment');
      const updated = await this.table('invoice_autopay_attempts').where({ attempt_id: attempt.attempt_id, status: 'processing' }).update({ status: 'succeeded', payment_intent_id: result.paymentIntentId, processed_at: this.knex.fn.now(), updated_at: this.knex.fn.now() });
      if (updated !== 1) return { status: 'cancelled' };
      return { status: 'succeeded' };
    }
    if (result.status === 'processing') {
      const updated = await this.table('invoice_autopay_attempts').where({ attempt_id: attempt.attempt_id, status: 'processing' }).update({ payment_intent_id: result.paymentIntentId });
      if (updated !== 1) return { status: 'cancelled' };
      return { status: 'processing', processingStartedAt: new Date(attempt.updated_at).toISOString() };
    }
    return await this.failAttempt(attempt, result);
  }

  async evaluateEnrollmentForInvoice(attemptId: string): Promise<{ status: 'disabled' | 'none' | 'unchanged' | 'changed'; paymentMethodId?: string }> {
    const attempt = await this.table('invoice_autopay_attempts').where({ attempt_id: attemptId }).first();
    if (!attempt) throw new Error(`Auto-pay attempt ${attemptId} does not exist`);
    const config = await this.table('payment_provider_configs').where({ provider_type: 'stripe', is_enabled: true }).first();
    if ((config?.settings as any)?.autopayEnabled !== true) return { status: 'disabled' };
    const enrollment = await this.table('billing_profile_autopay').where({ billing_profile_id: attempt.billing_profile_id, is_enabled: true }).first();
    if (!enrollment) return { status: 'none' };
    const method = await this.table('payment_methods').where({ payment_method_id: enrollment.payment_method_id, billing_profile_id: attempt.billing_profile_id, is_deleted: false, status: 'active' }).first();
    if (!method?.external_payment_method_id || !method.external_customer_id) return { status: 'none' };
    return method.payment_method_id === attempt.payment_method_id ? { status: 'unchanged' } : { status: 'changed', paymentMethodId: method.payment_method_id };
  }

  async createRetryAttempt(previousAttemptId: string, retryAtIso: string): Promise<{ attemptId: string; scheduledFor: string }> {
    const previous = await this.table('invoice_autopay_attempts').where({ attempt_id: previousAttemptId }).first();
    if (!previous) throw new Error(`Auto-pay attempt ${previousAttemptId} does not exist`);
    const existingRetry = await this.table('invoice_autopay_attempts').where({ invoice_id: previous.invoice_id,
      attempt_number: Number(previous.attempt_number) + 1 }).whereIn('status', ['scheduled', 'processing']).first();
    if (existingRetry) return { attemptId: existingRetry.attempt_id, scheduledFor: new Date(existingRetry.scheduled_for).toISOString() };
    await this.table('invoice_autopay_attempts').where({ attempt_id: previousAttemptId }).whereIn('status', ['scheduled', 'failed', 'requires_action']).update({ status: 'cancelled', processed_at: this.knex.fn.now(), updated_at: this.knex.fn.now() });
    const id = uuidv4();
    await this.table('invoice_autopay_attempts').insert({ tenant: this.tenantId, attempt_id: id, invoice_id: previous.invoice_id,
      billing_profile_id: previous.billing_profile_id, payment_method_id: previous.payment_method_id, attempt_number: Number(previous.attempt_number) + 1,
      scheduled_for: new Date(retryAtIso), status: 'scheduled', amount: previous.amount, currency: previous.currency,
      provider_type: previous.provider_type, payment_intent_id: null, idempotency_key: `autopay:${this.tenantId}:${previous.invoice_id}:${id}`,
      failure_code: null, failure_message: null, decline_code: null, created_at: this.knex.fn.now(), updated_at: this.knex.fn.now() });
    return { attemptId: id, scheduledFor: retryAtIso };
  }

  async reconcileAttempt(attemptId: string, noIntentFound = false): Promise<any> {
    const attempt = await this.table('invoice_autopay_attempts').where({ attempt_id: attemptId }).first();
    if (!attempt) throw new Error(`Auto-pay attempt ${attemptId} does not exist`);
    if (attempt.status === 'failed' || attempt.status === 'requires_action') {
      const config = await this.table('payment_provider_configs').where({ provider_type: 'stripe', is_enabled: true }).first();
      const retryDays: number[] = Array.isArray(config?.settings?.autopayRetryDays) ? config.settings.autopayRetryDays : [3, 5, 7];
      const classification = classifyAutopayFailure(attempt.failure_code, attempt.decline_code, Number(attempt.attempt_number), retryDays.length);
      const nextRetryAt = retryAt(new Date(), retryDays, Number(attempt.attempt_number));
      return { status: attempt.status, retryAt: classification.retryable && !classification.hardDecline ? nextRetryAt?.toISOString() ?? null : null, hard: classification.hardDecline };
    }
    const intent = await createStripePaymentProvider(this.tenantId).retrieveAttemptPaymentIntent(attemptId);
    if (!intent) {
      if (!noIntentFound) return { status: 'unresolved', processingStartedAt: new Date(attempt.updated_at).toISOString() };
      return this.failAttempt(attempt, { status: 'failed', failureCode: 'no_intent_found', message: 'No Stripe payment intent was found after 72 hours' });
    }
    if (intent.status === 'succeeded') {
      const paymentService = await PaymentService.create(this.tenantId);
      await paymentService.recordAutoPaySuccess({ invoiceId: attempt.invoice_id, amount: Number(intent.amount_received || intent.amount), currency: attempt.currency, paymentIntentId: intent.id, attemptId });
      await this.table('invoice_autopay_attempts').where({ attempt_id: attemptId, status: 'processing' }).update({ status: 'succeeded', payment_intent_id: intent.id, processed_at: this.knex.fn.now(), updated_at: this.knex.fn.now() });
      return { status: 'succeeded' };
    }
    if (intent.status === 'requires_payment_method' || intent.status === 'canceled') {
      return this.failAttempt(attempt, { status: 'failed', paymentIntentId: intent.id, failureCode: intent.last_payment_error?.code, declineCode: intent.last_payment_error?.decline_code, message: intent.last_payment_error?.message });
    }
    return { status: 'unresolved', processingStartedAt: new Date(attempt.updated_at).toISOString() };
  }

  async finishAutopayWithFallback(invoiceId: string, attemptId: string | undefined, reason: string): Promise<void> {
    if (attemptId) await this.table('invoice_autopay_attempts').where({ attempt_id: attemptId }).whereIn('status', ['scheduled', 'processing']).update({ status: 'cancelled', processed_at: this.knex.fn.now(), updated_at: this.knex.fn.now() });
    const paymentService = await PaymentService.create(this.tenantId);
    const link = await paymentService.getOrCreatePaymentLink(invoiceId);
    const invoice = await this.table('invoices').where({ invoice_id: invoiceId }).first();
    if (!invoice) return;
    const recipient = await resolveInvoiceBillingRecipient({ knexOrTrx: this.knex, tenantId: this.tenantId, clientId: invoice.client_id });
    if (recipient.recipientEmail && link?.url) {
      const emailService = await getSystemEmailService();
      const safeUrl = link.url.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
      await emailService.sendEmail({ to: recipient.recipientEmail, tenantId: this.tenantId, entityType: 'invoice', entityId: invoiceId,
        subject: `Payment needed for invoice ${invoice.invoice_number ?? ''}`.trim(),
        html: `<p>We could not complete auto-pay for invoice ${invoice.invoice_number ?? ''}.</p><p><a href="${safeUrl}">Pay invoice</a></p>`,
        text: `We could not complete auto-pay for invoice ${invoice.invoice_number ?? ''}. Pay here: ${link.url}` });
    }
    const failedAt = new Date().toISOString();
    await publishWorkflowEvent({ eventType: 'PAYMENT_FAILED', payload: buildPaymentFailedPayload({ invoiceId, clientId: invoice.client_id,
      failedAt, amount: Number(invoice.total_amount), currency: invoice.currency_code ?? 'USD', method: 'stripe', failureCode: reason,
      failureMessage: reason === 'payment_failed' ? 'Auto-pay attempts were exhausted' : 'Auto-pay is no longer available for this billing profile', retryable: false }),
      ctx: { tenantId: this.tenantId, occurredAt: failedAt, actor: { actorType: 'SYSTEM' } },
      idempotencyKey: `autopay_fallback:${attemptId ?? invoiceId}` });
  }

  async cancelAttemptById(attemptId: string): Promise<void> {
    await this.table('invoice_autopay_attempts').where({ attempt_id: attemptId }).whereIn('status', ['scheduled', 'processing'])
      .update({ status: 'cancelled', processed_at: this.knex.fn.now(), updated_at: this.knex.fn.now() });
  }

  async listAutopayReconcileWork(): Promise<Array<{ invoiceId: string; hasOpenAttempt: boolean }>> {
    const open = await this.table('invoice_autopay_attempts').whereIn('status', ['scheduled', 'processing']).select('invoice_id');
    const missed = await this.table('invoices').where({ 'invoices.status': 'sent' }).whereNotNull('invoices.finalized_at')
      .where('invoices.finalized_at', '>=', this.knex.raw("now() - interval '7 days'"))
      .whereNotExists(function (this: Knex.QueryBuilder) { this.select(1).from('invoice_autopay_attempts as aa').whereRaw('aa.tenant = invoices.tenant').whereRaw('aa.invoice_id = invoices.invoice_id'); })
      .whereExists((q) => q.select(this.knex.raw('1')).from('billing_profile_autopay as ba').whereRaw('ba.tenant = invoices.tenant')
        .whereRaw('ba.billing_profile_id = COALESCE(invoices.billing_profile_id, (SELECT cbp.billing_profile_id FROM client_billing_profiles cbp WHERE cbp.tenant = invoices.tenant AND cbp.client_id = invoices.client_id AND cbp.is_default = true LIMIT 1))')
        .where('ba.is_enabled', true).whereRaw('ba.authorized_at <= invoices.finalized_at')).select('invoices.invoice_id');
    const result = new Map<string, boolean>();
    for (const row of missed) result.set(row.invoice_id, false);
    for (const row of open) result.set(row.invoice_id, true);
    return [...result].map(([invoiceId, hasOpenAttempt]) => ({ invoiceId, hasOpenAttempt }));
  }

  private async failAttempt(attempt: any, failure: any): Promise<{ status: 'failed' | 'requires_action'; retryAt: string | null; hard: boolean }> {
    const config = await this.table('payment_provider_configs').where({ provider_type: 'stripe', is_enabled: true }).first();
    const settings = (config?.settings ?? {}) as Record<string, any>;
    const retryDays: number[] = Array.isArray(settings.autopayRetryDays) ? settings.autopayRetryDays : [3, 5, 7];
    const classification = classifyAutopayFailure(failure.failureCode, failure.declineCode, Number(attempt.attempt_number), retryDays.length);
    const hard = classification.hardDecline;
    const nextRetryAt = retryAt(new Date(), retryDays, Number(attempt.attempt_number));
    const retry = classification.retryable && nextRetryAt !== null;
    const status = failure.status === 'requires_action' ? 'requires_action' : 'failed';
    const updated = await this.table('invoice_autopay_attempts').where({ attempt_id: attempt.attempt_id, status: 'processing' }).update({ status, payment_intent_id: failure.paymentIntentId || null,
        failure_code: failure.failureCode ?? null, failure_message: failure.message ?? null, decline_code: failure.declineCode ?? null,
        processed_at: this.knex.fn.now(), updated_at: this.knex.fn.now() });
    if (updated !== 1) return { status: 'failed', retryAt: null, hard: false };
    if (hard) await this.table('payment_methods').where({ payment_method_id: attempt.payment_method_id }).update({ status: 'requires_update', updated_at: this.knex.fn.now() });
    const invoice = await this.table('invoices').where({ invoice_id: attempt.invoice_id }).first();
    const failureAt = new Date().toISOString();
    await publishWorkflowEvent({ eventType: 'PAYMENT_FAILED', payload: buildPaymentFailedPayload({ invoiceId: attempt.invoice_id, clientId: invoice?.client_id,
      failedAt: failureAt, amount: Number(attempt.amount), currency: attempt.currency, method: 'stripe', failureCode: failure.failureCode,
      failureMessage: failure.message, retryable: !!retry }), ctx: { tenantId: this.tenantId, occurredAt: failureAt, actor: { actorType: 'SYSTEM' } },
      idempotencyKey: `autopay_failed:${attempt.attempt_id}` });
    return { status, retryAt: retry ? nextRetryAt!.toISOString() : null, hard };
  }

  private async cancelAttempt(attemptId: string): Promise<void> {
    await this.cancelAttemptById(attemptId);
  }
}
