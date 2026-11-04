import { afterEach, describe, expect, it } from 'vitest';
import {
  ALLOWED_LABEL_NAMES,
  LABEL_VALUE_ENUMS,
  METRIC_PREFIX,
  createInboundEmailMetrics,
} from './registry';
import { createPromSink } from './promSink';
import {
  installInboundEmailMetricsSink,
  recordAuthFailure,
  recordAutoPause,
  recordConsumerLoopError,
  recordImapListenerError,
  recordImapOauthAuthRetry,
  recordImapWebhookDispatchRetry,
  recordMessageOutcome,
  recordQueueJobOutcome,
  observeQueueJobDuration,
  resetInboundEmailMetricsSinkForTests,
} from '@alga-psa/shared/services/email/inboundEmailMetrics';
import type { InboundEmailHealthSnapshot } from '@alga-psa/shared/services/email/inboundEmailHealthSnapshot';
import { createHealthCollector } from './healthCollector';

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const EMAIL_RE = /[^\s@]+@[^\s@]+/;

const TENANT = '3f2b8c1e-5a47-4d0e-9a6b-1c2d3e4f5a6b';
const ADVERSARIAL = [
  TENANT,
  'someone@customer.example.com',
  'Error: AADSTS7000222 secret for tenant 3f2b8c1e expired',
  'microsoft:invalid_client:3f2b8c1e-5a47-4d0e-9a6b-1c2d3e4f5a6b',
  '',
  null,
  undefined,
  42,
  { tenant: TENANT },
];

afterEach(() => resetInboundEmailMetricsSinkForTests());

function syntheticSnapshot(): InboundEmailHealthSnapshot {
  return {
    collectedAt: new Date().toISOString(),
    // Source rows as the DB would hand them back; snapshot values are already
    // bounded, but the label test also proves nothing in the registry leaks.
    providers: [{ providerType: 'microsoft', status: 'connected', count: 3 }],
    paused: [{ providerType: 'microsoft', reason: 'auth_failure', code: 'microsoft:invalid_client', count: 11 }],
    authFailing: [{ providerType: 'google', code: 'google:invalid_grant', count: 1 }],
    microsoft: {
      subscriptions: { healthy: 1, expiring_lt_12h: 1, expired: 2, missing: 0 },
      deliveryMode: { webhook: 3, polling: 1 },
      silentWebhooks: 1,
    },
    gmail: { watches: { healthy: 1, expiring_lt_12h: 0, expired: 1, missing: 0 } },
    sync: { stale: { imap: 1, microsoft: 0, google: 0 }, oldestLivenessAgeSeconds: { imap: 7200 } },
    durable: {
      inbox: { processing: 1, retryable_failed: 2, terminal_failed: 0 },
      outboxPending: 4,
      oldestPendingOutboxAgeSeconds: 12,
      artifactsPending: 1,
    },
  };
}

describe('registry label bounding', () => {
  it('only exposes allowlisted label names and enum values, never ids or emails', async () => {
    const metrics = createInboundEmailMetrics({ durableMode: 'enforce' });
    metrics.setLiveStateProvider(() => ({
      activeListeners: 2,
      providersLeased: 1,
      consumerLastTickMs: { v1: Date.now(), v2: Date.now() },
    }));
    installInboundEmailMetricsSink(createPromSink(metrics));

    for (const a of ADVERSARIAL) {
      recordQueueJobOutcome({ queue: a, providerType: a, outcome: a });
      observeQueueJobDuration({ queue: a, providerType: a, seconds: 1 });
      recordMessageOutcome({ providerType: a, outcome: a, reason: a });
      recordAuthFailure({ providerType: a, code: a });
      recordAutoPause({ providerType: a, code: a });
      recordImapListenerError({ reason: a });
      recordConsumerLoopError({ queue: a });
    }
    recordImapWebhookDispatchRetry();
    recordImapOauthAuthRetry();

    const collector = createHealthCollector({
      metrics,
      collectSnapshot: async () => syntheticSnapshot(),
      readQueueDepths: async () => ({
        v1: { ready: 1, processing: 0, inflight: 0, dlq: 0 },
        v2: { ready: 1, processing: 0, inflight: 0, dlq: 2, delayed: 3 },
      }),
    });
    await collector.tick();

    const allowedNames = new Set<string>([...ALLOWED_LABEL_NAMES, 'le', 'quantile']);
    const families = await metrics.register.getMetricsAsJSON();
    const inbound = families.filter((f) => f.name.startsWith(METRIC_PREFIX));
    expect(inbound.length).toBeGreaterThan(20);

    for (const family of families) {
      for (const sample of (family as any).values ?? []) {
        for (const [name, value] of Object.entries(sample.labels ?? {})) {
          if (!family.name.startsWith(METRIC_PREFIX)) continue; // default process_/nodejs_ metrics
          expect(allowedNames.has(name), `${family.name} has label ${name}`).toBe(true);
          const text = String(value);
          expect(UUID_RE.test(text), `${family.name}{${name}=${text}}`).toBe(false);
          expect(EMAIL_RE.test(text), `${family.name}{${name}=${text}}`).toBe(false);
          if (name === 'le') continue;
          expect(LABEL_VALUE_ENUMS[name as keyof typeof LABEL_VALUE_ENUMS], `${family.name}{${name}=${text}}`).toContain(text);
        }
      }
    }

    // The exposition text itself carries no id or email either.
    const text = await metrics.register.metrics();
    const inboundLines = text.split('\n').filter((l) => l.startsWith(METRIC_PREFIX));
    for (const line of inboundLines) {
      expect(UUID_RE.test(line)).toBe(false);
      expect(EMAIL_RE.test(line)).toBe(false);
    }
  });

  it('emits every family named in the plan', async () => {
    const metrics = createInboundEmailMetrics({ durableMode: 'shadow' });
    const names = new Set((await metrics.register.getMetricsAsJSON()).map((f) => f.name));
    for (const suffix of [
      'queue_jobs_total', 'job_duration_seconds', 'messages_total', 'auth_failures_total',
      'provider_auto_paused_total', 'imap_listener_errors_total', 'imap_webhook_dispatch_retries_total',
      'imap_oauth_auth_retries_total', 'consumer_loop_errors_total', 'imap_active_listeners',
      'imap_providers_leased', 'consumer_last_tick_timestamp_seconds', 'service_info', 'providers',
      'providers_paused', 'providers_auth_failing', 'microsoft_subscriptions', 'microsoft_delivery_mode',
      'microsoft_webhooks_silent', 'gmail_watches', 'oldest_liveness_age_seconds', 'providers_sync_stale',
      'queue_depth', 'durable_inbox', 'durable_outbox_pending', 'durable_oldest_pending_outbox_age_seconds',
      'durable_artifacts_pending', 'health_collector_last_success_timestamp_seconds',
      'health_collector_last_duration_seconds', 'health_collector_failures_total',
    ]) {
      expect(names.has(METRIC_PREFIX + suffix), suffix).toBe(true);
    }
  });

  it('uses its own registry, not the prom-client global one', async () => {
    const { register: globalRegister } = await import('prom-client');
    const metrics = createInboundEmailMetrics();
    expect(metrics.register).not.toBe(globalRegister);
    expect((await globalRegister.getMetricsAsJSON()).some((f) => f.name.startsWith(METRIC_PREFIX))).toBe(false);
  });
});
