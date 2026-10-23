import type { InboundEmailMetricsSink } from '@alga-psa/shared/services/email/inboundEmailMetrics';
import type { InboundEmailMetrics } from './registry';

/**
 * Backs the dependency-free shared sink with prom-client counters. The shared
 * recording functions already normalize every label to a bounded enum, so this
 * only forwards.
 */
export function createPromSink(metrics: InboundEmailMetrics): InboundEmailMetricsSink {
  const c = metrics.counters;
  return {
    queueJob: (e) => c.queueJobs.inc({ queue: e.queue, provider_type: e.providerType, outcome: e.outcome }),
    jobDuration: (e) => metrics.jobDuration.observe({ queue: e.queue, provider_type: e.providerType }, e.seconds),
    message: (e) => c.messages.inc({ provider_type: e.providerType, outcome: e.outcome, reason: e.reason }),
    authFailure: (e) => c.authFailures.inc({ provider_type: e.providerType, code: e.code }),
    autoPaused: (e) => c.autoPaused.inc({ provider_type: e.providerType, code: e.code }),
    imapListenerError: (e) => c.imapListenerErrors.inc({ reason: e.reason }),
    imapWebhookDispatchRetry: () => c.imapWebhookRetries.inc(),
    imapOauthAuthRetry: () => c.imapOauthRetries.inc(),
    consumerLoopError: (e) => c.consumerLoopErrors.inc({ queue: e.queue }),
  };
}
