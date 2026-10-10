/**
 * Cross-tenant inbound email fleet health snapshot.
 *
 * Aggregate-only: every query is GROUP BY bounded columns and the tenant
 * column never appears in a select list, so the returned object carries no
 * tenant id, provider id, mailbox or free-text error. Per-tenant detail stays
 * in the DB and the logs.
 *
 * Consumed by the email-service health collector (Prometheus gauges and the
 * `/status` summary). It is pure apart from the knex queries.
 */

import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import {
  SUBSCRIPTION_STATE_VALUES,
  normalizeAuthCode,
  normalizePauseReason,
  normalizeProviderStatus,
  normalizeProviderType,
  type MetricAuthCode,
  type MetricDeliveryMode,
  type MetricDurableInboxStatus,
  type MetricPauseReason,
  type MetricProviderStatus,
  type MetricProviderType,
  type MetricSubscriptionState,
} from './inboundEmailMetrics';

const COLLECTOR_TENANT_LABEL = 'inbound-email-health-collector';
const QUERY_TIMEOUT = '10s';
const EXPIRING_WINDOW_SECONDS = 12 * 60 * 60;

export type SyncProviderType = 'imap' | 'microsoft' | 'google';

export interface InboundEmailHealthThresholds {
  /** Liveness older than this counts the provider as stale, per type. */
  syncStaleSeconds: Record<SyncProviderType, number>;
}

export const DEFAULT_INBOUND_EMAIL_HEALTH_THRESHOLDS: InboundEmailHealthThresholds = {
  syncStaleSeconds: {
    imap: 3_600,
    microsoft: 7_200,
    // A quiet Gmail mailbox has no liveness signal besides push.
    google: 86_400,
  },
};

function positiveIntFromEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export function readInboundEmailHealthThresholdsFromEnv(): InboundEmailHealthThresholds {
  const d = DEFAULT_INBOUND_EMAIL_HEALTH_THRESHOLDS.syncStaleSeconds;
  return {
    syncStaleSeconds: {
      imap: positiveIntFromEnv('EMAIL_SERVICE_SYNC_STALE_SECONDS_IMAP', d.imap),
      microsoft: positiveIntFromEnv('EMAIL_SERVICE_SYNC_STALE_SECONDS_MICROSOFT', d.microsoft),
      google: positiveIntFromEnv('EMAIL_SERVICE_SYNC_STALE_SECONDS_GOOGLE', d.google),
    },
  };
}

export interface InboundEmailHealthSnapshot {
  collectedAt: string;
  providers: Array<{ providerType: MetricProviderType; status: MetricProviderStatus; count: number }>;
  paused: Array<{
    providerType: MetricProviderType;
    reason: MetricPauseReason;
    code: MetricAuthCode | 'none';
    count: number;
  }>;
  authFailing: Array<{ providerType: MetricProviderType; code: MetricAuthCode; count: number }>;
  microsoft: {
    subscriptions: Record<MetricSubscriptionState, number>;
    deliveryMode: Record<MetricDeliveryMode, number>;
    silentWebhooks: number;
  };
  gmail: { watches: Record<MetricSubscriptionState, number> };
  sync: {
    stale: Record<SyncProviderType, number>;
    /** Only present for types with at least one live-checked provider. */
    oldestLivenessAgeSeconds: Partial<Record<SyncProviderType, number>>;
  };
  /** Null when durable mode is off. */
  durable: null | {
    inbox: Record<MetricDurableInboxStatus, number>;
    outboxPending: number;
    oldestPendingOutboxAgeSeconds: number;
    artifactsPending: number;
  };
}

export interface CollectInboundEmailHealthSnapshotParams {
  knex: Knex;
  now?: Date;
  thresholds?: InboundEmailHealthThresholds;
  includeDurable?: boolean;
}

function emptyStateCounts(): Record<MetricSubscriptionState, number> {
  return Object.fromEntries(SUBSCRIPTION_STATE_VALUES.map((s) => [s, 0])) as Record<MetricSubscriptionState, number>;
}

function num(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function sumInto<K extends string>(map: Map<K, number>, key: K, n: number): void {
  map.set(key, (map.get(key) ?? 0) + n);
}

/**
 * CASE expression classifying a subscription/watch expiry column against
 * `now` (bound as the first `?`) and the expiring window.
 */
function expiryStateSql(column: string): string {
  return `CASE
    WHEN ${column} IS NULL THEN 'missing'
    WHEN ${column} < ?::timestamptz THEN 'expired'
    WHEN ${column} < ?::timestamptz + (${EXPIRING_WINDOW_SECONDS} * interval '1 second') THEN 'expiring_lt_12h'
    ELSE 'healthy'
  END`;
}

export async function collectInboundEmailHealthSnapshot(
  params: CollectInboundEmailHealthSnapshotParams
): Promise<InboundEmailHealthSnapshot> {
  const now = params.now ?? new Date();
  const nowIso = now.toISOString();
  const thresholds = params.thresholds ?? DEFAULT_INBOUND_EMAIL_HEALTH_THRESHOLDS;

  // One read transaction with a hard statement timeout so a slow Citus plan
  // cannot pile up behind the collector interval.
  return params.knex.transaction(async (trx) => {
    await trx.raw(`SET LOCAL statement_timeout = '${QUERY_TIMEOUT}'`);
    const facade = tenantDb(trx, COLLECTOR_TENANT_LABEL);
    const providerRoot = () =>
      facade.unscoped('email_providers as ep', 'cross-tenant inbound email fleet health aggregates (no tenant in select)');

    // 1. providers by type/status (active only, any pause state).
    const providerRows = await providerRoot()
      .where('ep.is_active', true)
      .select('ep.provider_type', 'ep.status')
      .count('* as n')
      .groupBy('ep.provider_type', 'ep.status');
    const providerCounts = new Map<string, number>();
    for (const row of providerRows) {
      const key = `${normalizeProviderType(row.provider_type)}|${normalizeProviderStatus(row.status)}`;
      sumInto(providerCounts, key, num(row.n));
    }

    // 2. paused providers.
    const pausedRows = await providerRoot()
      .where('ep.is_active', true)
      .whereNotNull('ep.inbound_paused_at')
      .select('ep.provider_type', 'ep.inbound_pause_reason', 'ep.inbound_auth_failure_code')
      .count('* as n')
      .groupBy('ep.provider_type', 'ep.inbound_pause_reason', 'ep.inbound_auth_failure_code');
    const pausedCounts = new Map<string, number>();
    for (const row of pausedRows) {
      // Codes are normalized in JS and counts re-summed after normalization.
      const code = row.inbound_auth_failure_code ? normalizeAuthCode(row.inbound_auth_failure_code) : 'none';
      const key = [
        normalizeProviderType(row.provider_type),
        normalizePauseReason(row.inbound_pause_reason),
        code,
      ].join('|');
      sumInto(pausedCounts, key, num(row.n));
    }

    // 3. auth-failing but not (yet) paused: the early rotation signal.
    const authFailingRows = await providerRoot()
      .where('ep.is_active', true)
      .whereNull('ep.inbound_paused_at')
      .where('ep.inbound_auth_failure_count', '>', 0)
      .select('ep.provider_type', 'ep.inbound_auth_failure_code')
      .count('* as n')
      .groupBy('ep.provider_type', 'ep.inbound_auth_failure_code');
    const authFailingCounts = new Map<string, number>();
    for (const row of authFailingRows) {
      const key = `${normalizeProviderType(row.provider_type)}|${normalizeAuthCode(row.inbound_auth_failure_code)}`;
      sumInto(authFailingCounts, key, num(row.n));
    }

    // 4. Microsoft. Deliberately NO `status` filter: renewal failure can set
    // status='error' and that is exactly the expired-subscription case.
    const msRoot = providerRoot();
    facade.tenantJoin(msRoot, 'microsoft_email_provider_config as mpc', 'ep.id', 'mpc.email_provider_id', {
      rootTenantColumn: 'ep.tenant',
    });
    const msRows = await msRoot
      .where('ep.is_active', true)
      .whereNull('ep.inbound_paused_at')
      .select(
        'mpc.delivery_mode',
        trx.raw(
          `CASE WHEN mpc.delivery_mode = 'webhook' THEN ${expiryStateSql('mpc.webhook_expires_at')} END AS state`,
          [nowIso, nowIso]
        ),
        trx.raw('SUM(CASE WHEN mpc.webhook_silent_runs > 0 THEN 1 ELSE 0 END) AS silent')
      )
      .count('* as n')
      .groupByRaw('1, 2');
    const msSubscriptions = emptyStateCounts();
    const msDelivery: Record<MetricDeliveryMode, number> = { webhook: 0, polling: 0 };
    let silentWebhooks = 0;
    for (const row of msRows) {
      const mode: MetricDeliveryMode = row.delivery_mode === 'webhook' ? 'webhook' : 'polling';
      msDelivery[mode] += num(row.n);
      silentWebhooks += num(row.silent);
      if (mode === 'webhook' && (SUBSCRIPTION_STATE_VALUES as readonly string[]).includes(row.state)) {
        msSubscriptions[row.state as MetricSubscriptionState] += num(row.n);
      }
    }

    // 5. Gmail watches.
    const gRoot = providerRoot();
    facade.tenantJoin(gRoot, 'google_email_provider_config as gpc', 'ep.id', 'gpc.email_provider_id', {
      rootTenantColumn: 'ep.tenant',
    });
    const gRows = await gRoot
      .where('ep.is_active', true)
      .whereNull('ep.inbound_paused_at')
      .select(trx.raw(`${expiryStateSql('gpc.watch_expiration')} AS state`, [nowIso, nowIso]))
      .count('* as n')
      .groupByRaw('1');
    const gmailWatches = emptyStateCounts();
    for (const row of gRows) {
      if ((SUBSCRIPTION_STATE_VALUES as readonly string[]).includes(row.state)) {
        gmailWatches[row.state as MetricSubscriptionState] += num(row.n);
      }
    }

    // 6. Liveness (F3). `last_sync_at` alone only advances on ingested
    // messages for Microsoft/Google, so quiet mailboxes would look stale.
    //  - imap:      last_sync_at, advanced on every sync loop (even empty).
    //  - microsoft: GREATEST(last_sync_at, last_reconciliation_at,
    //               last_webhook_delivery_at). Reconciliation runs for
    //               webhook-mode providers too (silence detection) and, in
    //               durable mode off/shadow, advances the cursor on every pass
    //               including empty ones. KNOWN LIMITATION: in durable
    //               `enforce` mode the cursor only moves with staged
    //               messages, so a quiet mailbox's liveness can age.
    //  - google:    GREATEST(last_sync_at, last_push_received_at).
    // NULL liveness counts as age since ep.created_at.
    const livenessExpr: Record<SyncProviderType, { table: string; alias: string; joinCol: string; expr: string }> = {
      imap: { table: '', alias: '', joinCol: '', expr: 'ep.last_sync_at' },
      microsoft: {
        table: 'microsoft_email_provider_config as mpc',
        alias: 'mpc',
        joinCol: 'mpc.email_provider_id',
        expr: 'GREATEST(ep.last_sync_at, mpc.last_reconciliation_at, mpc.last_webhook_delivery_at)',
      },
      google: {
        table: 'google_email_provider_config as gpc',
        alias: 'gpc',
        joinCol: 'gpc.email_provider_id',
        expr: 'GREATEST(ep.last_sync_at, gpc.last_push_received_at)',
      },
    };
    const stale: Record<SyncProviderType, number> = { imap: 0, microsoft: 0, google: 0 };
    const oldestLivenessAgeSeconds: Partial<Record<SyncProviderType, number>> = {};
    for (const type of ['imap', 'microsoft', 'google'] as const) {
      const spec = livenessExpr[type];
      const q = providerRoot();
      if (spec.table) {
        facade.tenantJoin(q, spec.table, 'ep.id', spec.joinCol, { rootTenantColumn: 'ep.tenant' });
      }
      const ageSql = `EXTRACT(EPOCH FROM (?::timestamptz - COALESCE(${spec.expr}, ep.created_at)))`;
      const row = await q
        .where('ep.provider_type', type)
        .where('ep.is_active', true)
        .whereNull('ep.inbound_paused_at')
        .whereNot('ep.status', 'disconnected')
        .select(
          trx.raw(`MAX(${ageSql}) AS max_age`, [nowIso]),
          trx.raw(`SUM(CASE WHEN ${ageSql} > ? THEN 1 ELSE 0 END) AS stale_count`, [
            nowIso,
            thresholds.syncStaleSeconds[type],
          ])
        )
        .count('* as n')
        .first();
      if (row && num(row.n) > 0) {
        stale[type] = num(row.stale_count);
        oldestLivenessAgeSeconds[type] = Math.max(0, Math.round(num(row.max_age)));
      }
    }

    // 7. Durable ledgers (cross-tenant counterpart of computeInboundEmailDiagnostics).
    let durable: InboundEmailHealthSnapshot['durable'] = null;
    if (params.includeDurable) {
      const inboxRows = await facade
        .unscoped('inbound_email_inbox', 'cross-tenant durable inbox status aggregates (no tenant in select)')
        .whereIn('status', ['processing', 'retryable_failed', 'terminal_failed'])
        .select('status')
        .count('* as n')
        .groupBy('status');
      const inbox: Record<MetricDurableInboxStatus, number> = {
        processing: 0,
        retryable_failed: 0,
        terminal_failed: 0,
      };
      for (const row of inboxRows) {
        if (row.status in inbox) inbox[row.status as MetricDurableInboxStatus] += num(row.n);
      }
      const outbox = await facade
        .unscoped('inbound_email_outbox', 'cross-tenant durable outbox backlog aggregate (no tenant in select)')
        .where('status', 'pending')
        .select(trx.raw('MIN(created_at) AS oldest'))
        .count('* as n')
        .first();
      const artifacts = await facade
        .unscoped('inbound_email_artifacts', 'cross-tenant durable artifact backlog aggregate (no tenant in select)')
        .where('status', 'pending')
        .count('* as n')
        .first();
      durable = {
        inbox,
        outboxPending: num(outbox?.n),
        oldestPendingOutboxAgeSeconds: outbox?.oldest
          ? Math.max(0, Math.round((now.getTime() - new Date(outbox.oldest).getTime()) / 1000))
          : 0,
        artifactsPending: num(artifacts?.n),
      };
    }

    return {
      collectedAt: nowIso,
      providers: [...providerCounts].map(([key, count]) => {
        const [providerType, status] = key.split('|');
        return { providerType: providerType as MetricProviderType, status: status as MetricProviderStatus, count };
      }),
      paused: [...pausedCounts].map(([key, count]) => {
        const [providerType, reason, code] = key.split('|');
        return {
          providerType: providerType as MetricProviderType,
          reason: reason as MetricPauseReason,
          code: code as MetricAuthCode | 'none',
          count,
        };
      }),
      authFailing: [...authFailingCounts].map(([key, count]) => {
        const [providerType, code] = key.split('|');
        return { providerType: providerType as MetricProviderType, code: code as MetricAuthCode, count };
      }),
      microsoft: { subscriptions: msSubscriptions, deliveryMode: msDelivery, silentWebhooks },
      gmail: { watches: gmailWatches },
      sync: { stale, oldestLivenessAgeSeconds },
      durable,
    };
  });
}
