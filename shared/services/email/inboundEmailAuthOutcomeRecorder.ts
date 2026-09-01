/**
 * Shared source-access auth-outcome recorder for inbound email runtimes
 * outside the V1 queue processor (the standalone IMAP email-service listener
 * loop and the durable-V2 ingress staging worker).
 *
 * Semantics are identical to the V1 boundary in
 * `unifiedInboundEmailQueueJobProcessor.processUnifiedInboundEmailQueueJob`:
 *
 * - only strictly classified terminal credential failures advance the
 *   consecutive-failure counter (and can trip the automatic pause);
 * - any successful provider source access resets the counter;
 * - recording/resetting failures are logged and never fatal — the caller's
 *   own error handling and retry policy stay authoritative;
 * - downstream (ticket/artifact/outbox) processing must never call this.
 *
 * The lifecycle service is lazy-imported so importing this module never
 * changes a runtime's static module graph (it is loaded from inside the
 * email-service IMAP listener, which must not pull the adapter stack at
 * module-load time).
 */

import {
  classifyInboundAuthFailure,
  type InboundAuthFailureProviderType,
} from './InboundEmailAuthFailurePolicy';

export interface RecordInboundSourceAuthOutcomeParams {
  tenant: string;
  providerId: string;
  providerType: InboundAuthFailureProviderType;
  error: unknown;
  /** Log label for the calling runtime, e.g. 'imap-email-service'. */
  source: string;
}

export interface RecordInboundSourceAuthOutcomeResult {
  unrecoverable: boolean;
  autoPaused: boolean;
}

export interface RecordInboundSourceAccessSuccessParams {
  tenant: string;
  providerId: string;
  /** Log label for the calling runtime. */
  source: string;
}

/**
 * Reset the consecutive auth-failure counter after a successful provider
 * source access (including a fetch that returned no new messages).
 * Best-effort: logged, never thrown.
 */
export async function recordInboundSourceAccessSuccess(
  params: RecordInboundSourceAccessSuccessParams
): Promise<void> {
  try {
    const { EmailProviderLifecycleService } = await import('./EmailProviderLifecycleService');
    await new EmailProviderLifecycleService().recordSourceAccessSuccess(
      params.providerId,
      params.tenant
    );
  } catch (error) {
    console.warn('[InboundEmailAuthOutcome] failed to reset auth-failure counter', {
      event: 'inbound_email_auth_failure_reset_failed',
      source: params.source,
      tenantId: params.tenant,
      providerId: params.providerId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Classify a source-access failure strictly and, when it is a terminal
 * credential failure, advance the provider's auth-failure counter (which may
 * atomically trip the automatic pause and dispatch the admin notification).
 * Never throws and never mutates the original error's propagation.
 */
export async function recordInboundSourceAuthFailure(
  params: RecordInboundSourceAuthOutcomeParams
): Promise<RecordInboundSourceAuthOutcomeResult> {
  const classification = classifyInboundAuthFailure({
    providerType: params.providerType,
    error: params.error,
  });
  if (classification.kind !== 'unrecoverable_auth') {
    return { unrecoverable: false, autoPaused: false };
  }

  try {
    const { EmailProviderLifecycleService } = await import('./EmailProviderLifecycleService');
    const outcome = await new EmailProviderLifecycleService().recordUnrecoverableAuthFailure(
      params.providerId,
      params.tenant,
      classification.code
    );
    if (outcome.autoPaused) {
      console.info('[InboundEmailAuthOutcome] provider auto-paused after repeated auth failures', {
        event: 'inbound_email_provider_auto_paused',
        source: params.source,
        tenantId: params.tenant,
        providerId: params.providerId,
        providerType: params.providerType,
        authFailureCode: classification.code,
        count: outcome.count,
      });
    }
    return { unrecoverable: true, autoPaused: outcome.autoPaused };
  } catch (error) {
    console.warn('[InboundEmailAuthOutcome] failed to record auth failure', {
      event: 'inbound_email_auth_failure_record_failed',
      source: params.source,
      tenantId: params.tenant,
      providerId: params.providerId,
      authFailureCode: classification.code,
      error: error instanceof Error ? error.message : String(error),
    });
    return { unrecoverable: true, autoPaused: false };
  }
}
