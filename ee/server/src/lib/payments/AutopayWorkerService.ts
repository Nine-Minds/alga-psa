import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { getConnection, tenantDb } from '@alga-psa/db';
import { createStripePaymentProvider } from './StripePaymentProvider';
import { classifyAutopayFailure, retryAt, shouldScheduleAutopay } from './autopayPolicy';
import { getAutopayPaymentLink, expireAutopayPaymentLinks, recordAutopayPayment } from './autopayWorkerPayments';
import { resolveInvoiceBillingRecipient } from '@alga-psa/billing/services/invoiceBillingRecipientService';
import { publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import logger from '@alga-psa/core/logger';

function computeBalanceDue(input: { totalAmount: number; creditApplied: number; totalPaid: number }): number {
  return Math.round(input.totalAmount) - Math.round(input.creditApplied) - Math.round(input.totalPaid);
}

function buildAutopayPaymentFailedPayload(params: {
  invoiceId: string; clientId: string; failedAt: string; amount: number; currency: string;
  method: string; failureCode: string; failureMessage: string; retryable: boolean;
}) {
  return { ...params, amount: String(Math.max(0, Number.isFinite(params.amount) ? params.amount : 0)) };
}

export class AutopayWorkerService {
  private constructor(private readonly tenantId: string, private readonly knex: Knex) {}
  static async create(tenantId: string): Promise<AutopayWorkerService> {
    return new AutopayWorkerService(tenantId, await getConnection());
  }
  private table(name: string): Knex.QueryBuilder<any, any> {
    return tenantDb(this.knex, this.tenantId).table(name);
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
  async executeAttempt(attemptId: string): Promise<{ status: 'succeeded' | 'processing' | 'failed' | 'requires_action' | 'cancelled'; reason?: 'invoice_settled' | 'no_balance' | 'no_chargeable_method'; retryAt?: string | null; hard?: boolean; processingStartedAt?: string }> {
    let attempt = await this.table('invoice_autopay_attempts').where({ attempt_id: attemptId }).first();
    if (!attempt) throw new Error(`Auto-pay attempt ${attemptId} does not exist`);
    if (attempt.status === 'failed' || attempt.status === 'requires_action') return this.reconcileAttempt(attemptId);
    if (!['scheduled', 'processing'].includes(attempt.status)) return attempt.status === 'succeeded' ? { status: 'succeeded' } : { status: 'cancelled', reason: 'invoice_settled' };
    if (attempt.status === 'scheduled') {
      const claimed = await this.table('invoice_autopay_attempts').where({ attempt_id: attemptId, status: 'scheduled' })
        .update({ status: 'processing', updated_at: this.knex.fn.now() });
      attempt = await this.table('invoice_autopay_attempts').where({ attempt_id: attemptId }).first();
      if (claimed !== 1 && attempt?.status !== 'processing') return this.outcomeForExistingAttempt(attemptId, attempt);
    }
    const invoice = await this.table('invoices').where({ invoice_id: attempt.invoice_id }).first();
    if (!invoice) throw new Error(`Invoice ${attempt.invoice_id} not found`);
    if (['paid', 'cancelled', 'void'].includes(invoice.status)) { await this.cancelAttempt(attemptId); return { status: 'cancelled', reason: 'invoice_settled' }; }
    const config = await this.table('payment_provider_configs').where({ provider_type: 'stripe', is_enabled: true }).first();
    if (!config) throw new Error('Auto-pay is not configured for this tenant');
    const settings = (config?.settings ?? {}) as Record<string, any>;
    const enrollment = settings.autopayEnabled === true ? await this.table('billing_profile_autopay').where({ billing_profile_id: attempt.billing_profile_id, is_enabled: true }).first() : null;
    const method = enrollment ? await this.table('payment_methods').where({ payment_method_id: enrollment.payment_method_id, billing_profile_id: attempt.billing_profile_id, is_deleted: false, status: 'active' }).first() : null;
    if (!method?.external_payment_method_id || !method.external_customer_id) { await this.cancelAttempt(attemptId); return { status: 'cancelled', reason: 'no_chargeable_method' }; }
    await this.table('invoice_autopay_attempts').where({ attempt_id: attemptId, status: 'processing' }).update({ payment_method_id: method.payment_method_id });
    attempt.payment_method_id = method.payment_method_id;
    const payments = await this.table('invoice_payments').where({ invoice_id: attempt.invoice_id }).sum('amount as total').first();
    const amount = computeBalanceDue({ totalAmount: Number(invoice.total_amount), creditApplied: Number(invoice.credit_applied ?? 0), totalPaid: Number(payments?.total ?? 0) });
    if (amount <= 0) { await this.cancelAttempt(attemptId); return { status: 'cancelled', reason: 'no_balance' }; }
    const stripeProvider = createStripePaymentProvider(this.tenantId);
    // A live Checkout link is retired before the charge; failure leaves this attempt processing for reconciliation.
    await expireAutopayPaymentLinks(this.knex, this.tenantId, attempt.invoice_id, stripeProvider);
    let result;
    if (Date.now() - new Date(attempt.updated_at).getTime() >= 24 * 60 * 60 * 1000) {
      const existingIntent = await createStripePaymentProvider(this.tenantId).retrieveAttemptPaymentIntent(attempt.attempt_id);
      if (!existingIntent) return { status: 'processing', processingStartedAt: new Date(attempt.updated_at).toISOString() };
      if (existingIntent.status === 'succeeded') {
        const landed = await recordAutopayPayment(this.knex, this.tenantId, { invoiceId: attempt.invoice_id,
          amount: Number(existingIntent.amount_received || existingIntent.amount), currency: attempt.currency,
          paymentIntentId: existingIntent.id });
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
      const landed = await recordAutopayPayment(this.knex, this.tenantId, { invoiceId: attempt.invoice_id, amount, currency: attempt.currency,
        paymentIntentId: result.paymentIntentId });
      if (!landed.success) throw new Error(landed.error ?? 'Unable to record auto-pay payment');
      const updated = await this.table('invoice_autopay_attempts').where({ attempt_id: attempt.attempt_id, status: 'processing' }).update({ status: 'succeeded', payment_intent_id: result.paymentIntentId, processed_at: this.knex.fn.now(), updated_at: this.knex.fn.now() });
      if (updated !== 1) return this.outcomeForExistingAttempt(attemptId, await this.table('invoice_autopay_attempts').where({ attempt_id: attemptId }).first());
      return { status: 'succeeded' };
    }
    if (result.status === 'processing') {
      const updated = await this.table('invoice_autopay_attempts').where({ attempt_id: attempt.attempt_id, status: 'processing' }).update({ payment_intent_id: result.paymentIntentId });
      if (updated !== 1) return this.outcomeForExistingAttempt(attemptId, await this.table('invoice_autopay_attempts').where({ attempt_id: attemptId }).first());
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
      await recordAutopayPayment(this.knex, this.tenantId, { invoiceId: attempt.invoice_id, amount: Number(intent.amount_received || intent.amount), currency: attempt.currency, paymentIntentId: intent.id });
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
    const invoice = await this.table('invoices').where({ invoice_id: invoiceId }).first();
    if (!invoice) return;
    const payments = await this.table('invoice_payments').where({ invoice_id: invoiceId }).sum('amount as total').first();
    const balanceDue = computeBalanceDue({ totalAmount: Number(invoice.total_amount), creditApplied: Number(invoice.credit_applied ?? 0), totalPaid: Number(payments?.total ?? 0) });
    if (invoice.status !== 'sent' || balanceDue <= 0) return;
    const link = await getAutopayPaymentLink(this.knex, this.tenantId, invoiceId, createStripePaymentProvider(this.tenantId));
    const recipient = await resolveInvoiceBillingRecipient({ knexOrTrx: this.knex, tenantId: this.tenantId, clientId: invoice.client_id });
    if (recipient.recipientEmail && link?.url) {
      const { getSystemEmailService } = await import('@alga-psa/email');
      const emailService = await getSystemEmailService();
      const safeUrl = link.url.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
      await emailService.sendEmail({ to: recipient.recipientEmail, tenantId: this.tenantId, entityType: 'invoice', entityId: invoiceId,
        subject: `Payment needed for invoice ${invoice.invoice_number ?? ''}`.trim(),
        html: `<p>We could not complete auto-pay for invoice ${invoice.invoice_number ?? ''}.</p><p><a href="${safeUrl}">Pay invoice</a></p>`,
        text: `We could not complete auto-pay for invoice ${invoice.invoice_number ?? ''}. Pay here: ${link.url}` });
    }
    const failedAt = new Date().toISOString();
    await publishWorkflowEvent({ eventType: 'PAYMENT_FAILED', payload: buildAutopayPaymentFailedPayload({ invoiceId, clientId: invoice.client_id,
      failedAt, amount: Number(invoice.total_amount), currency: invoice.currency_code ?? 'USD', method: 'stripe', failureCode: reason,
      failureMessage: reason === 'payment_failed' ? 'Auto-pay attempts were exhausted' : 'Auto-pay is no longer available for this billing profile', retryable: false }),
      ctx: { tenantId: this.tenantId, occurredAt: failedAt, actor: { actorType: 'SYSTEM' } },
      idempotencyKey: `autopay_fallback:${attemptId ?? invoiceId}` });

    let profileQuery = this.table('client_billing_profiles');
    if (invoice.billing_profile_id) {
      profileQuery = profileQuery.where({ billing_profile_id: invoice.billing_profile_id });
    } else {
      profileQuery = profileQuery.where({ client_id: invoice.client_id, is_default: true });
    }
    const profile = await profileQuery.first('created_by', 'updated_by');
    const client = await this.table('clients').where({ client_id: invoice.client_id }).first('account_manager_id');
    const recipientIds = [...new Set([client?.account_manager_id, profile?.updated_by, profile?.created_by].filter(Boolean))];
    const recipients = recipientIds.length
      ? await this.table('users').whereIn('user_id', recipientIds).where({ user_type: 'internal', is_inactive: false }).select('user_id')
      : [];
    for (const { user_id: userId } of recipients) {
      const existing = await this.table('internal_notifications').where({ user_id: userId, template_name: 'autopay-payment-failed' })
        .whereRaw("metadata->>'invoiceId' = ?", [invoiceId]).first('internal_notification_id');
      if (existing) continue;
      await this.table('internal_notifications').insert({
        tenant: this.tenantId,
        user_id: userId,
        template_name: 'autopay-payment-failed',
        language_code: 'en',
        title: `Auto-pay failed for invoice ${invoice.invoice_number ?? invoiceId}`,
        message: `Auto-pay could not be completed. The client has been sent a payment link. Reason: ${reason}.`,
        type: 'warning',
        category: 'billing',
        link: `/msp/billing/invoices/${invoiceId}`,
        metadata: JSON.stringify({ invoiceId, reason, paymentLinkId: link?.paymentLinkId ?? null }),
        is_read: false,
        delivery_status: 'pending',
        delivery_attempts: 0,
        created_at: this.knex.fn.now(),
        updated_at: this.knex.fn.now(),
      });
    }
  }

  async cancelAttemptById(attemptId: string): Promise<void> {
    await this.table('invoice_autopay_attempts').where({ attempt_id: attemptId }).where({ status: 'scheduled' })
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
    await publishWorkflowEvent({ eventType: 'PAYMENT_FAILED', payload: buildAutopayPaymentFailedPayload({ invoiceId: attempt.invoice_id, clientId: invoice?.client_id,
      failedAt: failureAt, amount: Number(attempt.amount), currency: attempt.currency, method: 'stripe', failureCode: failure.failureCode,
      failureMessage: failure.message, retryable: !!retry }), ctx: { tenantId: this.tenantId, occurredAt: failureAt, actor: { actorType: 'SYSTEM' } },
      idempotencyKey: `autopay_failed:${attempt.attempt_id}` });
    return { status, retryAt: retry ? nextRetryAt!.toISOString() : null, hard };
  }

  private async cancelAttempt(attemptId: string): Promise<void> {
    await this.cancelProcessingAttemptById(attemptId);
  }

  private async cancelProcessingAttemptById(attemptId: string): Promise<void> {
    await this.table('invoice_autopay_attempts').where({ attempt_id: attemptId, status: 'processing' })
      .update({ status: 'cancelled', processed_at: this.knex.fn.now(), updated_at: this.knex.fn.now() });
  }

  private async outcomeForExistingAttempt(attemptId: string, attempt: any): Promise<any> {
    if (!attempt) throw new Error(`Auto-pay attempt ${attemptId} does not exist`);
    if (attempt.status === 'succeeded') return { status: 'succeeded' };
    if (attempt.status === 'processing') return { status: 'processing', processingStartedAt: new Date(attempt.updated_at).toISOString() };
    if (attempt.status === 'failed' || attempt.status === 'requires_action') return this.reconcileAttempt(attemptId);
    return { status: 'cancelled', reason: 'invoice_settled' };
  }
}
