/**
 * Inbound email metrics: a dependency-free sink interface plus bounded-label
 * normalizers.
 *
 * Shared inbound-email code runs in three processes (email-service, the
 * Next.js server and temporal-worker). Only email-service installs a real sink
 * (backed by prom-client); everywhere else the default no-op applies, so this
 * module must not import prom-client or anything else.
 *
 * Rules enforced here, not at call sites:
 *  - every label value is reduced to a bounded enum (unknown -> `other`);
 *    tenant ids, provider ids, mailboxes and free-text errors can never reach
 *    a label;
 *  - a throwing sink is swallowed. Metrics must never break mail processing.
 */

// ---------------------------------------------------------------------------
// Bounded label enums (exported for the registry and the label-bounding test)
// ---------------------------------------------------------------------------

export const PROVIDER_TYPE_VALUES = ['microsoft', 'google', 'imap', 'other'] as const;
export type MetricProviderType = (typeof PROVIDER_TYPE_VALUES)[number];

export const QUEUE_VALUES = ['v1', 'v2'] as const;
export type MetricQueue = (typeof QUEUE_VALUES)[number];

export const QUEUE_JOB_OUTCOME_VALUES = [
  'ack',
  'retry',
  'dlq',
  'reclaim',
  'invalid_payload',
  'skip',
  'defer',
  'stale',
] as const;
export type MetricQueueJobOutcome = (typeof QUEUE_JOB_OUTCOME_VALUES)[number];

export const MESSAGE_OUTCOME_VALUES = [
  'created',
  'replied',
  'deduped',
  'quarantined',
  'skipped',
  'failed',
] as const;
export type MetricMessageOutcome = (typeof MESSAGE_OUTCOME_VALUES)[number];

export const MESSAGE_REASON_VALUES = [
  'none',
  'missing_defaults',
  'invalid_email_data',
  'self_notification',
  'notification_loop',
  'rule_skip',
  'unauthorized_thread_header_sender',
  'provider_inactive',
  'provider_paused',
  'source_unavailable',
  'no_messages_from_pointer',
  'processing_record_exists',
  'error',
  'other',
] as const;
export type MetricMessageReason = (typeof MESSAGE_REASON_VALUES)[number];

export const AUTH_CODE_VALUES = [
  'microsoft:invalid_client',
  'microsoft:invalid_grant',
  'microsoft:invalid_grant:aadsts50173',
  'google:invalid_grant',
  'imap:invalid_client',
  'imap:invalid_grant',
  'imap:authentication_failed',
  'other',
] as const;
export type MetricAuthCode = (typeof AUTH_CODE_VALUES)[number];

export const PAUSE_REASON_VALUES = ['manual', 'tenant_cancelled', 'auth_failure', 'other'] as const;
export type MetricPauseReason = (typeof PAUSE_REASON_VALUES)[number];

export const IMAP_LISTENER_ERROR_REASON_VALUES = ['auth', 'timeout', 'connection', 'other'] as const;
export type MetricImapListenerErrorReason = (typeof IMAP_LISTENER_ERROR_REASON_VALUES)[number];

/** Fleet-gauge label enums (set by the email-service health collector). */
export const PROVIDER_STATUS_VALUES = ['connected', 'disconnected', 'error', 'configuring', 'other'] as const;
export type MetricProviderStatus = (typeof PROVIDER_STATUS_VALUES)[number];

export const SUBSCRIPTION_STATE_VALUES = ['healthy', 'expiring_lt_12h', 'expired', 'missing'] as const;
export type MetricSubscriptionState = (typeof SUBSCRIPTION_STATE_VALUES)[number];

export const DELIVERY_MODE_VALUES = ['webhook', 'polling'] as const;
export type MetricDeliveryMode = (typeof DELIVERY_MODE_VALUES)[number];

export const QUEUE_DEPTH_STATE_VALUES = ['ready', 'processing', 'inflight', 'dlq', 'delayed'] as const;
export type MetricQueueDepthState = (typeof QUEUE_DEPTH_STATE_VALUES)[number];

export const DURABLE_INBOX_STATUS_VALUES = ['processing', 'retryable_failed', 'terminal_failed'] as const;
export type MetricDurableInboxStatus = (typeof DURABLE_INBOX_STATUS_VALUES)[number];

/** `code` label values of the paused-providers gauge: auth codes plus `none` for non-auth pauses. */
export const PAUSED_CODE_VALUES = [...AUTH_CODE_VALUES, 'none'] as const;

export const DURABLE_MODE_VALUES = ['off', 'shadow', 'enforce'] as const;

// ---------------------------------------------------------------------------
// Normalizers
// ---------------------------------------------------------------------------

function pickFromEnum<T extends string>(
  allowed: readonly T[],
  value: unknown,
  fallback: T
): T {
  if (typeof value !== 'string') return fallback;
  const candidate = value.trim().toLowerCase();
  return (allowed as readonly string[]).includes(candidate) ? (candidate as T) : fallback;
}

export function normalizeProviderType(value: unknown): MetricProviderType {
  return pickFromEnum(PROVIDER_TYPE_VALUES, value, 'other');
}

export function normalizeProviderStatus(value: unknown): MetricProviderStatus {
  return pickFromEnum(PROVIDER_STATUS_VALUES, value, 'other');
}

export function normalizeQueue(value: unknown): MetricQueue {
  return pickFromEnum(QUEUE_VALUES, value, 'v1');
}

export function normalizeQueueJobOutcome(value: unknown): MetricQueueJobOutcome {
  // Unknown outcomes are mapped to `skip` (the most neutral member).
  return pickFromEnum(QUEUE_JOB_OUTCOME_VALUES, value, 'skip');
}

export function normalizeMessageOutcome(value: unknown): MetricMessageOutcome {
  return pickFromEnum(MESSAGE_OUTCOME_VALUES, value, 'skipped');
}

/**
 * `source_unavailable:<detail>` is reduced to `source_unavailable`; anything
 * outside the allowlist (including free-text error strings) becomes `other`.
 */
export function normalizeMessageReason(value: unknown): MetricMessageReason {
  if (value === null || value === undefined || value === '') return 'none';
  if (typeof value !== 'string') return 'other';
  const candidate = value.trim().toLowerCase();
  if (candidate === '') return 'none';
  if (candidate === 'source_unavailable' || candidate.startsWith('source_unavailable:')) {
    return 'source_unavailable';
  }
  return pickFromEnum(MESSAGE_REASON_VALUES, candidate, 'other');
}

/**
 * Maps an auth-failure code (from `classifyInboundAuthFailure`, or read back
 * from `email_providers.inbound_auth_failure_code`) onto the allowlist. Google
 * and IMAP `error_subtype` suffixes collapse to their base code; unknown codes
 * become `other`. The AADSTS50173 Microsoft code is an explicit allowlist
 * member and is kept.
 */
export function normalizeAuthCode(value: unknown): MetricAuthCode {
  if (typeof value !== 'string') return 'other';
  const candidate = value.trim().toLowerCase();
  if ((AUTH_CODE_VALUES as readonly string[]).includes(candidate) && candidate !== 'other') {
    return candidate as MetricAuthCode;
  }
  const parts = candidate.split(':');
  if (parts.length > 2 && (parts[0] === 'google' || parts[0] === 'imap')) {
    return pickFromEnum(AUTH_CODE_VALUES, `${parts[0]}:${parts[1]}`, 'other');
  }
  return 'other';
}

export function normalizePauseReason(value: unknown): MetricPauseReason {
  return pickFromEnum(PAUSE_REASON_VALUES, value, 'other');
}

export function normalizeImapListenerErrorReason(value: unknown): MetricImapListenerErrorReason {
  return pickFromEnum(IMAP_LISTENER_ERROR_REASON_VALUES, value, 'other');
}

// ---------------------------------------------------------------------------
// Sink
// ---------------------------------------------------------------------------

export interface InboundEmailMetricsSink {
  queueJob(event: {
    queue: MetricQueue;
    providerType: MetricProviderType;
    outcome: MetricQueueJobOutcome;
  }): void;
  jobDuration(event: { queue: MetricQueue; providerType: MetricProviderType; seconds: number }): void;
  message(event: {
    providerType: MetricProviderType;
    outcome: MetricMessageOutcome;
    reason: MetricMessageReason;
  }): void;
  authFailure(event: { providerType: MetricProviderType; code: MetricAuthCode }): void;
  autoPaused(event: { providerType: MetricProviderType; code: MetricAuthCode }): void;
  imapListenerError(event: { reason: MetricImapListenerErrorReason }): void;
  imapWebhookDispatchRetry(): void;
  imapOauthAuthRetry(): void;
  consumerLoopError(event: { queue: MetricQueue }): void;
}

export const NOOP_INBOUND_EMAIL_METRICS_SINK: InboundEmailMetricsSink = {
  queueJob() {},
  jobDuration() {},
  message() {},
  authFailure() {},
  autoPaused() {},
  imapListenerError() {},
  imapWebhookDispatchRetry() {},
  imapOauthAuthRetry() {},
  consumerLoopError() {},
};

let sink: InboundEmailMetricsSink = NOOP_INBOUND_EMAIL_METRICS_SINK;

export function installInboundEmailMetricsSink(next: InboundEmailMetricsSink): void {
  sink = next;
}

export function resetInboundEmailMetricsSinkForTests(): void {
  sink = NOOP_INBOUND_EMAIL_METRICS_SINK;
}

function safely(fn: () => void): void {
  try {
    fn();
  } catch {
    // Metrics must never break mail processing.
  }
}

// ---------------------------------------------------------------------------
// Recording API (what call sites use)
// ---------------------------------------------------------------------------

export function recordQueueJobOutcome(event: {
  queue: unknown;
  providerType?: unknown;
  outcome: unknown;
}): void {
  safely(() =>
    sink.queueJob({
      queue: normalizeQueue(event.queue),
      providerType: normalizeProviderType(event.providerType),
      outcome: normalizeQueueJobOutcome(event.outcome),
    })
  );
}

export function observeQueueJobDuration(event: {
  queue: unknown;
  providerType?: unknown;
  seconds: number;
}): void {
  safely(() => {
    if (!Number.isFinite(event.seconds) || event.seconds < 0) return;
    sink.jobDuration({
      queue: normalizeQueue(event.queue),
      providerType: normalizeProviderType(event.providerType),
      seconds: event.seconds,
    });
  });
}

export function recordMessageOutcome(event: {
  providerType?: unknown;
  outcome: unknown;
  reason?: unknown;
}): void {
  safely(() =>
    sink.message({
      providerType: normalizeProviderType(event.providerType),
      outcome: normalizeMessageOutcome(event.outcome),
      reason: normalizeMessageReason(event.reason),
    })
  );
}

export function recordAuthFailure(event: { providerType?: unknown; code?: unknown }): void {
  safely(() =>
    sink.authFailure({
      providerType: normalizeProviderType(event.providerType),
      code: normalizeAuthCode(event.code),
    })
  );
}

export function recordAutoPause(event: { providerType?: unknown; code?: unknown }): void {
  safely(() =>
    sink.autoPaused({
      providerType: normalizeProviderType(event.providerType),
      code: normalizeAuthCode(event.code),
    })
  );
}

export function recordImapListenerError(event: { reason?: unknown }): void {
  safely(() => sink.imapListenerError({ reason: normalizeImapListenerErrorReason(event.reason) }));
}

export function recordImapWebhookDispatchRetry(): void {
  safely(() => sink.imapWebhookDispatchRetry());
}

export function recordImapOauthAuthRetry(): void {
  safely(() => sink.imapOauthAuthRetry());
}

export function recordConsumerLoopError(event: { queue: unknown }): void {
  safely(() => sink.consumerLoopError({ queue: normalizeQueue(event.queue) }));
}
