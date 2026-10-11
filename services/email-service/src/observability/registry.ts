/**
 * Prometheus registry for email-service inbound health.
 *
 * prom-client lives only in this process. The registry is an instance (not
 * the global default) so tests can build isolated ones. Label names are a
 * closed set (see ALLOWED_LABEL_NAMES); the label-bounding test walks the
 * registry and fails on anything outside it.
 */

import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
import {
  AUTH_CODE_VALUES,
  DELIVERY_MODE_VALUES,
  DURABLE_INBOX_STATUS_VALUES,
  DURABLE_MODE_VALUES,
  IMAP_LISTENER_ERROR_REASON_VALUES,
  MESSAGE_OUTCOME_VALUES,
  MESSAGE_REASON_VALUES,
  PAUSED_CODE_VALUES,
  PAUSE_REASON_VALUES,
  PROVIDER_STATUS_VALUES,
  PROVIDER_TYPE_VALUES,
  QUEUE_DEPTH_STATE_VALUES,
  QUEUE_JOB_OUTCOME_VALUES,
  QUEUE_VALUES,
  SUBSCRIPTION_STATE_VALUES,
} from '@alga-psa/shared/services/email/inboundEmailMetrics';

export const METRIC_PREFIX = 'alga_inbound_email_';

/** Every label name any family may carry. */
export const ALLOWED_LABEL_NAMES = [
  'provider_type',
  'outcome',
  'reason',
  'code',
  'queue',
  'state',
  'status',
  'mode',
  'durable_mode',
] as const;

/** Allowed values per label name; `le` (histogram buckets) is handled separately. */
export const LABEL_VALUE_ENUMS: Record<(typeof ALLOWED_LABEL_NAMES)[number], readonly string[]> = {
  provider_type: PROVIDER_TYPE_VALUES,
  // `outcome` is shared by queue jobs and messages.
  outcome: [...new Set([...QUEUE_JOB_OUTCOME_VALUES, ...MESSAGE_OUTCOME_VALUES])],
  reason: [...new Set([...MESSAGE_REASON_VALUES, ...PAUSE_REASON_VALUES, ...IMAP_LISTENER_ERROR_REASON_VALUES])],
  code: PAUSED_CODE_VALUES,
  queue: QUEUE_VALUES,
  // `state` is shared by subscriptions/watches and queue depth.
  state: [...new Set([...SUBSCRIPTION_STATE_VALUES, ...QUEUE_DEPTH_STATE_VALUES])],
  // `status` is shared by provider status and durable inbox status.
  status: [...new Set([...PROVIDER_STATUS_VALUES, ...DURABLE_INBOX_STATUS_VALUES])],
  mode: DELIVERY_MODE_VALUES,
  durable_mode: DURABLE_MODE_VALUES,
};

export interface LiveState {
  activeListeners: number;
  providersLeased: number;
  /** Epoch ms of the last successful consumer tick, or null if none yet. */
  consumerLastTickMs: { v1: number | null; v2: number | null };
}

export type LiveStateProvider = () => LiveState;

export const FLEET_GAUGE_NAMES = [
  'providers',
  'providers_paused',
  'providers_auth_failing',
  'microsoft_subscriptions',
  'microsoft_delivery_mode',
  'microsoft_webhooks_silent',
  'gmail_watches',
  'oldest_liveness_age_seconds',
  'providers_sync_stale',
  'queue_depth',
  'durable_inbox',
  'durable_outbox_pending',
  'durable_oldest_pending_outbox_age_seconds',
  'durable_artifacts_pending',
] as const;

export function createInboundEmailMetrics(options: { durableMode?: string; liveState?: LiveStateProvider } = {}) {
  const register = new Registry();
  collectDefaultMetrics({ register });

  let liveState: LiveStateProvider | undefined = options.liveState;
  const readLive = (): LiveState | undefined => {
    try {
      return liveState?.();
    } catch {
      return undefined;
    }
  };

  const counter = (name: string, help: string, labelNames: string[] = []) =>
    new Counter({ name: METRIC_PREFIX + name, help, labelNames, registers: [register] });
  const gauge = (name: string, help: string, labelNames: string[] = [], collect?: (g: Gauge<string>) => void) =>
    new Gauge({
      name: METRIC_PREFIX + name,
      help,
      labelNames,
      registers: [register],
      ...(collect ? { collect() { collect(this as unknown as Gauge<string>); } } : {}),
    });

  // ---- event metrics -----------------------------------------------------
  const queueJobs = counter('queue_jobs_total', 'Queue job dispositions.', ['queue', 'provider_type', 'outcome']);
  const jobDuration = new Histogram({
    name: METRIC_PREFIX + 'job_duration_seconds',
    help: 'Queue job handler duration.',
    labelNames: ['queue', 'provider_type'],
    buckets: [0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 90, 120],
    registers: [register],
  });
  const messages = counter('messages_total', 'Inbound messages by outcome.', ['provider_type', 'outcome', 'reason']);
  const authFailures = counter('auth_failures_total', 'Unrecoverable inbound auth failures.', ['provider_type', 'code']);
  const autoPaused = counter('provider_auto_paused_total', 'Providers auto-paused after auth failure.', [
    'provider_type',
    'code',
  ]);
  const imapListenerErrors = counter('imap_listener_errors_total', 'IMAP folder listener errors.', ['reason']);
  const imapWebhookRetries = counter('imap_webhook_dispatch_retries_total', 'IMAP webhook dispatch retries.');
  const imapOauthRetries = counter('imap_oauth_auth_retries_total', 'IMAP OAuth auth retries.');
  const consumerLoopErrors = counter('consumer_loop_errors_total', 'Errors caught in the consumer loop.', ['queue']);

  // ---- live gauges (read in-process state at scrape time; no I/O) -------
  gauge('imap_active_listeners', 'Connected IMAP folder listeners.', [], (g) => {
    const live = readLive();
    if (live) g.set(live.activeListeners);
  });
  gauge('imap_providers_leased', 'IMAP providers leased by this replica.', [], (g) => {
    const live = readLive();
    if (live) g.set(live.providersLeased);
  });
  gauge('consumer_last_tick_timestamp_seconds', 'Unix time of the last successful consumer tick.', ['queue'], (g) => {
    const live = readLive();
    g.reset();
    if (!live) return;
    if (live.consumerLastTickMs.v1 !== null) g.set({ queue: 'v1' }, live.consumerLastTickMs.v1 / 1000);
    if (live.consumerLastTickMs.v2 !== null) g.set({ queue: 'v2' }, live.consumerLastTickMs.v2 / 1000);
  });
  const serviceInfo = gauge('service_info', 'Static service info; value is always 1.', ['durable_mode']);
  serviceInfo.set({ durable_mode: (DURABLE_MODE_VALUES as readonly string[]).includes(options.durableMode ?? '') ? options.durableMode! : 'off' }, 1);

  // ---- fleet gauges (set by the health collector) -----------------------
  const fleet = {
    providers: gauge('providers', 'Active providers by type and status.', ['provider_type', 'status']),
    providersPaused: gauge('providers_paused', 'Paused providers.', ['provider_type', 'reason', 'code']),
    providersAuthFailing: gauge('providers_auth_failing', 'Unpaused providers with auth failures.', [
      'provider_type',
      'code',
    ]),
    microsoftSubscriptions: gauge('microsoft_subscriptions', 'Microsoft webhook subscriptions by state.', ['state']),
    microsoftDeliveryMode: gauge('microsoft_delivery_mode', 'Microsoft providers by delivery mode.', ['mode']),
    microsoftWebhooksSilent: gauge('microsoft_webhooks_silent', 'Microsoft providers with silent webhook runs.'),
    gmailWatches: gauge('gmail_watches', 'Gmail watches by state.', ['state']),
    oldestLivenessAge: gauge('oldest_liveness_age_seconds', 'Oldest liveness age per provider type.', [
      'provider_type',
    ]),
    providersSyncStale: gauge('providers_sync_stale', 'Providers past their stale-sync threshold.', ['provider_type']),
    queueDepth: gauge('queue_depth', 'Redis queue depth.', ['queue', 'state']),
    durableInbox: gauge('durable_inbox', 'Durable inbox rows by non-success status.', ['status']),
    durableOutboxPending: gauge('durable_outbox_pending', 'Pending durable outbox rows.'),
    durableOldestOutboxAge: gauge(
      'durable_oldest_pending_outbox_age_seconds',
      'Age of the oldest pending durable outbox row.'
    ),
    durableArtifactsPending: gauge('durable_artifacts_pending', 'Pending durable artifacts.'),
  };
  const collector = {
    lastSuccess: gauge('health_collector_last_success_timestamp_seconds', 'Unix time of the last successful collection.'),
    lastDuration: gauge('health_collector_last_duration_seconds', 'Duration of the last collection.'),
    failures: counter('health_collector_failures_total', 'Failed health collections.'),
  };

  return {
    register,
    counters: {
      queueJobs,
      messages,
      authFailures,
      autoPaused,
      imapListenerErrors,
      imapWebhookRetries,
      imapOauthRetries,
      consumerLoopErrors,
    },
    jobDuration,
    fleet,
    collector,
    setLiveStateProvider(provider: LiveStateProvider) {
      liveState = provider;
    },
  };
}

export type InboundEmailMetrics = ReturnType<typeof createInboundEmailMetrics>;
