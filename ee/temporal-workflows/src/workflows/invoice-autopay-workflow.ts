import { condition, defineSignal, proxyActivities, setHandler, sleep } from '@temporalio/workflow';

export interface InvoiceAutopayInput { tenantId: string; invoiceId: string }
export interface InvoiceAutopayAttempt { attemptId: string; scheduledFor: string; processingStartedAt?: string }
export type AutopayOutcome =
  | { status: 'succeeded' | 'requires_action' }
  | { status: 'cancelled'; reason: 'invoice_settled' | 'no_balance' | 'no_chargeable_method' }
  | { status: 'processing'; processingStartedAt?: string }
  | { status: 'failed'; retryAt: string | null; hard: boolean };
export type EnrollmentEvaluation = { status: 'enabled'; paymentMethodId: string } | { status: 'disabled' | 'none' | 'unchanged' | 'changed'; paymentMethodId?: string };

export const enrollmentChanged = defineSignal('enrollmentChanged');
export const paymentIntentSettled = defineSignal<[{ attemptId: string; status: string }]>('paymentIntentSettled');
export const invoiceSettled = defineSignal('invoiceSettled');
export const chargeNow = defineSignal('chargeNow');

const activities = proxyActivities<{
  prepareInvoiceAutopay(input: InvoiceAutopayInput): Promise<{ status: 'skip'; reason: string } | InvoiceAutopayAttempt>;
  executeAutopayAttempt(input: InvoiceAutopayInput & { attemptId: string }): Promise<AutopayOutcome>;
  reconcileAutopayAttempt(input: InvoiceAutopayInput & { attemptId: string; noIntentFound?: boolean }): Promise<AutopayOutcome | { status: 'unresolved' }>;
  evaluateEnrollmentForInvoice(input: InvoiceAutopayInput & { attemptId: string }): Promise<EnrollmentEvaluation>;
  createRetryAttempt(input: InvoiceAutopayInput & { previousAttemptId: string; retryAt: string }): Promise<InvoiceAutopayAttempt>;
  finishAutopayWithFallback(input: InvoiceAutopayInput & { attemptId?: string; reason: string }): Promise<void>;
  cancelAutopayAttempt(input: InvoiceAutopayInput & { attemptId: string }): Promise<void>;
  listAutopayReconcileWork(): Promise<Array<{ tenantId: string; invoiceId: string }>>;
  startInvoiceAutopayWorkflow(input: InvoiceAutopayInput): Promise<void>;
}>({ startToCloseTimeout: '5m', retry: { maximumAttempts: 3 } });

const NO_INTENT_LIMIT_MS = 72 * 60 * 60 * 1000;

export async function invoiceAutopayWorkflow(input: InvoiceAutopayInput): Promise<void> {
  let enrollmentChangedFlag = false;
  let invoiceSettledFlag = false;
  let chargeNowFlag = false;
  let settledAttemptId: string | undefined;
  let settledStatus: string | undefined;
  setHandler(enrollmentChanged, () => { enrollmentChangedFlag = true; });
  setHandler(invoiceSettled, () => { invoiceSettledFlag = true; });
  setHandler(chargeNow, () => { chargeNowFlag = true; });
  setHandler(paymentIntentSettled, (signal) => { settledAttemptId = signal.attemptId; settledStatus = signal.status; });

  const prepared = await activities.prepareInvoiceAutopay(input);
  if ('status' in prepared && prepared.status === 'skip') return;
  let attempt = prepared as InvoiceAutopayAttempt;
  while (true) {
    let reconciledBeforeExecute: AutopayOutcome | undefined;
    if (invoiceSettledFlag) {
      invoiceSettledFlag = false;
      if (attempt.processingStartedAt) {
        const reconciled = await activities.reconcileAutopayAttempt({ ...input, attemptId: attempt.attemptId });
        if (reconciled.status === 'succeeded' || reconciled.status === 'failed' || reconciled.status === 'requires_action' || reconciled.status === 'cancelled') return;
        reconciledBeforeExecute = { status: 'processing', processingStartedAt: attempt.processingStartedAt };
      } else {
        await activities.cancelAutopayAttempt({ ...input, attemptId: attempt.attemptId });
        return;
      }
    }
    const waitMs = Math.max(0, new Date(attempt.scheduledFor).getTime() - Date.now());
    if (waitMs > 0) {
      const signalled = await condition(() => invoiceSettledFlag || enrollmentChangedFlag || chargeNowFlag, waitMs);
      if (invoiceSettledFlag) {
        await activities.cancelAutopayAttempt({ ...input, attemptId: attempt.attemptId });
        return;
      }
      if (enrollmentChangedFlag) {
        enrollmentChangedFlag = false;
        const enrollment = await activities.evaluateEnrollmentForInvoice({ ...input, attemptId: attempt.attemptId });
        if (enrollment.status === 'disabled' || enrollment.status === 'none') {
          await activities.finishAutopayWithFallback({ ...input, attemptId: attempt.attemptId, reason: enrollment.status });
          return;
        }
        if (enrollment.status === 'changed') {
          const next = await activities.createRetryAttempt({ ...input, previousAttemptId: attempt.attemptId, retryAt: new Date().toISOString() });
          attempt = next;
          continue;
        }
        if (enrollment.status === 'unchanged' && !chargeNowFlag && signalled) continue;
      }
      if (chargeNowFlag) chargeNowFlag = false;
    }

    let outcome = reconciledBeforeExecute ?? await activities.executeAutopayAttempt({ ...input, attemptId: attempt.attemptId });
    if (outcome.status === 'succeeded') return;
    if (outcome.status === 'cancelled') {
      const enrollment = await activities.evaluateEnrollmentForInvoice({ ...input, attemptId: attempt.attemptId });
      if (outcome.reason === 'no_chargeable_method' && (enrollment.status === 'disabled' || enrollment.status === 'none')) {
        await activities.finishAutopayWithFallback({ ...input, attemptId: attempt.attemptId, reason: enrollment.status });
      }
      return;
    }
    if (outcome.status === 'processing') {
      const processingStartedAt = outcome.processingStartedAt ? new Date(outcome.processingStartedAt).getTime() : Date.now();
      let backoffMs = 60 * 60 * 1000;
      while (Date.now() - processingStartedAt < NO_INTENT_LIMIT_MS) {
        await condition(() => invoiceSettledFlag || (settledAttemptId === attempt.attemptId && !!settledStatus), '1h');
        if (invoiceSettledFlag) {
          invoiceSettledFlag = false;
          const reconciled = await activities.reconcileAutopayAttempt({ ...input, attemptId: attempt.attemptId });
          if (reconciled.status === 'succeeded' || reconciled.status === 'failed' || reconciled.status === 'requires_action' || reconciled.status === 'cancelled') return;
          await sleep(backoffMs);
          backoffMs = Math.min(backoffMs * 2, 6 * 60 * 60 * 1000);
          continue;
        }
        if (settledAttemptId === attempt.attemptId && settledStatus === 'succeeded') return;
        if (settledAttemptId === attempt.attemptId && settledStatus === 'payment_failed') {
          const reconciled = await activities.reconcileAutopayAttempt({ ...input, attemptId: attempt.attemptId });
          if (reconciled.status !== 'unresolved') outcome = reconciled;
          break;
        }
        settledAttemptId = undefined;
        const reconciled = await activities.reconcileAutopayAttempt({ ...input, attemptId: attempt.attemptId });
        if (reconciled.status !== 'unresolved') { outcome = reconciled; break; }
        await sleep(backoffMs);
        backoffMs = Math.min(backoffMs * 2, 6 * 60 * 60 * 1000);
      }
      if (outcome.status === 'processing') {
        const marked = await activities.reconcileAutopayAttempt({ ...input, attemptId: attempt.attemptId, noIntentFound: true });
        outcome = marked.status === 'unresolved' ? { status: 'failed', retryAt: null, hard: false } : marked;
      }
    }
      if (outcome.status === 'failed' && outcome.retryAt) {
      const next = await activities.createRetryAttempt({ ...input, previousAttemptId: attempt.attemptId, retryAt: outcome.retryAt });
      attempt = next;
      continue;
    }
    await activities.finishAutopayWithFallback({ ...input, attemptId: attempt.attemptId, reason: outcome.status === 'failed' ? 'payment_failed' : outcome.status });
    return;
  }
}

export async function autopayReconcileWorkflow(): Promise<void> {
  const work = await activities.listAutopayReconcileWork();
  await Promise.all(work.map((item: any) => activities.startInvoiceAutopayWorkflow({ tenantId: item.tenantId, invoiceId: item.invoiceId })));
}
