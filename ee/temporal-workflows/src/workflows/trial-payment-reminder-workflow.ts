import { log, proxyActivities, sleep } from '@temporalio/workflow';
import type {
  ResolveTrialEndActivityInput,
  ResolveTrialEndActivityResult,
  SendTrialPaymentReminderActivityInput,
  SendTrialPaymentReminderActivityResult,
  TrialPaymentReminderWorkflowInput,
  TrialPaymentReminderWorkflowResult,
  VerifyTrialReminderActivityInput,
  VerifyTrialReminderActivityResult,
} from '../types/workflow-types.js';

const activities = proxyActivities<{
  resolveTrialEndFromStripe(
    input: ResolveTrialEndActivityInput
  ): Promise<ResolveTrialEndActivityResult>;
  verifyTenantBillableForTrialReminder(
    input: VerifyTrialReminderActivityInput
  ): Promise<VerifyTrialReminderActivityResult>;
  sendTrialPaymentReminderEmail(
    input: SendTrialPaymentReminderActivityInput
  ): Promise<SendTrialPaymentReminderActivityResult>;
}>({
  startToCloseTimeout: '1 minute',
  retry: {
    maximumAttempts: 3,
    initialInterval: '1 second',
    maximumInterval: '30 seconds',
    backoffCoefficient: 2,
  },
});

const REMINDER_LEAD_MS = 2 * 24 * 60 * 60 * 1000; // 2 days before the first payment
const MAX_TRIAL_END_MOVES = 5; // bound the re-sleep loop if the trial keeps moving

/**
 * Trial payment reminder workflow.
 *
 * Started as an abandoned child of tenant creation. Sleeps until two days
 * before the Stripe trial ends, re-verifies that the tenant has not cancelled
 * (or scheduled a cancellation) and is not suspended, then sends the reminder.
 * Verification failures are fail-closed: no email is sent.
 */
export async function trialPaymentReminderWorkflow(
  input: TrialPaymentReminderWorkflowInput
): Promise<TrialPaymentReminderWorkflowResult> {
  log.info('Starting trial payment reminder workflow', {
    tenantId: input.tenantId,
    stripeSubscriptionId: input.stripeSubscriptionId,
  });

  let trialEndIso: string;
  try {
    const resolved = await activities.resolveTrialEndFromStripe({
      stripeSubscriptionId: input.stripeSubscriptionId,
    });
    if (!resolved.trialEndIso) {
      log.info('No trial on subscription — nothing to remind about', {
        tenantId: input.tenantId,
      });
      return { emailSent: false, skipped: 'no_trial' };
    }
    trialEndIso = resolved.trialEndIso;
  } catch (error) {
    log.warn('Could not resolve trial end from Stripe — skipping reminder', {
      tenantId: input.tenantId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return {
      emailSent: false,
      skipped: 'unverifiable',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }

  for (let attempt = 0; attempt <= MAX_TRIAL_END_MOVES; attempt++) {
    const trialEndMs = Date.parse(trialEndIso);
    if (Number.isNaN(trialEndMs)) {
      log.warn('Stripe returned an unparseable trial end — skipping reminder', {
        tenantId: input.tenantId,
        trialEndIso,
      });
      return { emailSent: false, skipped: 'unverifiable', trialEnd: trialEndIso };
    }

    if (trialEndMs <= Date.now()) {
      log.info('Trial already ended — skipping reminder', {
        tenantId: input.tenantId,
        trialEnd: trialEndIso,
      });
      return { emailSent: false, skipped: 'trial_already_ended', trialEnd: trialEndIso };
    }

    // Trials shorter than the lead time (or reminders scheduled late) send now.
    const waitMs = trialEndMs - REMINDER_LEAD_MS - Date.now();
    if (waitMs > 0) {
      log.info('Waiting until two days before the first payment', {
        tenantId: input.tenantId,
        trialEnd: trialEndIso,
        waitMs,
      });
      await sleep(waitMs);
    }

    let verification: VerifyTrialReminderActivityResult;
    try {
      verification = await activities.verifyTenantBillableForTrialReminder({
        tenantId: input.tenantId,
        stripeSubscriptionId: input.stripeSubscriptionId,
      });
    } catch (error) {
      log.warn('Could not verify tenant billing state — skipping reminder', {
        tenantId: input.tenantId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return {
        emailSent: false,
        skipped: 'unverifiable',
        trialEnd: trialEndIso,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }

    if (!verification.sendable) {
      return {
        emailSent: false,
        skipped: verification.reason ?? 'unverifiable',
        trialEnd: trialEndIso,
      };
    }

    const currentTrialEndIso = verification.currentTrialEndIso ?? null;
    if (!currentTrialEndIso) {
      log.info('Trial was removed from the subscription — skipping reminder', {
        tenantId: input.tenantId,
      });
      return { emailSent: false, skipped: 'no_trial' };
    }

    if (Date.parse(currentTrialEndIso) > trialEndMs) {
      log.info('Trial was extended — rescheduling reminder', {
        tenantId: input.tenantId,
        previousTrialEnd: trialEndIso,
        trialEnd: currentTrialEndIso,
      });
      trialEndIso = currentTrialEndIso;
      continue;
    }

    const result = await activities.sendTrialPaymentReminderEmail({
      tenantId: input.tenantId,
      tenantName: input.companyName ?? input.tenantName,
      trialEndIso: currentTrialEndIso,
      companyName: input.companyName,
    });

    log.info('Trial payment reminder workflow completed', {
      tenantId: input.tenantId,
      emailSent: result.emailSent,
    });

    return {
      emailSent: result.emailSent,
      messageId: result.messageId,
      trialEnd: currentTrialEndIso,
      error: result.error,
    };
  }

  log.warn('Trial end kept moving — giving up on the reminder', {
    tenantId: input.tenantId,
    trialEnd: trialEndIso,
  });
  return { emailSent: false, skipped: 'trial_end_unstable', trialEnd: trialEndIso };
}
