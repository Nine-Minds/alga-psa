# Inbound email health metrics in email-service — implementation plan

Ticket: alga0002256. Branch: `feature/alga0002256-inbound-email-health-metrics-in-emai`.
Base read for this plan: worktree HEAD `b0d0b4dacf`. The brief cited `229a24f2ad`; every file and line reference below was re-checked against the current tree.

## Problem

Two inbound-email outages went unnoticed by anything fleet-level:

- **alga0002231.** Microsoft renewal PATCHes all returned 400, so subscriptions lapsed.
- **The 2026-08-14 secret rotation.** 19 providers were left with a dead secret. Auto-pause later paused 11 of them with `microsoft:invalid_client`.

Customers found both outages before we did. email-service needs to expose inbound health in a form that works in two settings:

- **Cloud:** Prometheus scrapes it and alerts fire.
- **On-premise appliance:** there is no monitoring stack. The status engine reads a JSON summary.

## Constraints that drive the design

1. **The appliance has no scraper.** Metrics live in-process and can be read without Prometheus. `/metrics` is one view of that data and `/status` is another. Nothing needs an env var, push target or external service to work.
2. **Shared code runs in three processes:** email-service, the Next.js server and temporal-worker. Only email-service gets a registry. The other two keep a no-op and gain no new dependency.
3. **Liveness must not depend on Redis or the DB.** `/health` stays as it is. Dependency checks go only on `/ready`, which only the readinessProbe uses.
4. **Labels are bounded.** No tenant id, provider id, mailbox or free-text error appears in any label. Per-tenant detail stays in the DB and the logs.

## Findings from the current code that change the brief

| # | Finding | Consequence |
|---|---------|-------------|
| F1 | `UnifiedInboundEmailQueueConsumer.start()` (`shared/services/email/unifiedInboundEmailQueueConsumer.ts:121`) awaits `runOnce()` with no try/catch. A thrown Redis error rejects `start()`, and `index.ts:56-59` then calls `process.exit(1)`. The default node-redis offline queue can instead make the loop **hang** silently. V2 has the same shape (`unifiedInboundEmailQueueConsumerV2.ts:275`). | The acceptance test "stop Redis → `/ready` 503, `/health` 200" cannot pass as the code stands. The loop must survive errors on each tick: catch, count, back off, and keep going. It must also expose a heartbeat that only advances on a **successful** tick, so both a hang and an error loop show up as a stale heartbeat. |
| F2 | `EmailProviderLifecycleService.recordUnrecoverableAuthFailure` (`EmailProviderLifecycleService.ts:286`) is the single choke point for every classified auth failure. Four paths reach it: the V1 processor, the IMAP listener (through `inboundEmailAuthOutcomeRecorder`), the V2 ingress staging worker, and `EmailWebhookMaintenanceService` (renewal). | Record `auth_failures_total` and `provider_auto_paused_total` **once, inside this method**, not at four call sites. The call from the renewal path runs in temporal-worker or pg-boss, where the metric is a no-op. The DB gauge in G3 covers that path. |
| F3 | `email_providers.last_sync_at` only advances when messages are actually ingested for Microsoft and Google (`unifiedInboundEmailQueueJobProcessor.ts:761`). IMAP advances it on every sync (`emailService.ts:923`), including empty ones. | "Stale = `last_sync_at` older than X" would page on every quiet M365 or Gmail mailbox. The plan uses a **per-type liveness timestamp** (G6) with per-type thresholds. |
| F4 | `EmailWebhookMaintenanceService.usePollingDelivery` (`:221`) sets `webhook_expires_at = NULL` and `delivery_mode = 'polling'`. Renewal failure can also set `email_providers.status = 'error'`. | The "expired subscription" gauge must **not** filter on `status = 'connected'`, or it hides the alga0002231 case. It filters on `is_active AND inbound_paused_at IS NULL AND delivery_mode = 'webhook'`. Expired subscriptions that fall back to polling show up in the delivery-mode gauge instead. |
| F5 | IMAP mail reaches the queue by webhook to the server, which does the enqueue. email-service never enqueues anything. | Do not add an enqueue counter, because it would always read 0 here. The queue-depth gauge covers backlog. |
| F6 | Google `invalid_grant` codes include the server-provided `error_subtype` (`InboundEmailAuthFailurePolicy.ts:110`), so the value set is open. | The code-label normalizer drops unknown subtypes. Codes outside the allowlist map to `other`. The same normalizer is applied to values read back from the DB. |
| F7 | The appliance has **three** separate status implementations, each with its own copy of the component table. The host-service `status-engine.mjs` (kubectl) backs the host status API. The operator CLI `operator/lib/status.mjs` (kubectl) is the second. The third is the in-cluster `appliance-status` pod: a JS server embedded in `flux/base/platform/appliance-status.yaml` that calls the kube REST API and `httpProbe`. | All three need the email-service health read. Mark it `// LEVERAGE: pattern appliance-status-triplicate` at each site. Do not merge them in this card. |
| F8 | A Helm install or upgrade waits for readiness. The appliance HelmRelease has `timeout: 30m` and `remediation.retries: 0`. | `/ready` should only fail when the pod truly cannot process mail: DB down, Redis down, or the consumer wedged. It must never fail on fleet-health conditions such as expired subscriptions. Those go on `/status` only. |

## Architecture

```
shared/services/email/
  inboundEmailMetrics.ts          ← typed recording API + no-op default + bounded label normalizers
  inboundEmailHealthSnapshot.ts   ← pure cross-tenant aggregate queries → tenant-free snapshot object
        ▲ used by call sites (queue, consumer, lifecycle, processors)        ▲ used only by email-service
services/email-service/src/observability/
  registry.ts        ← prom-client Registry (own instance, not the global) + all metric families
  promSink.ts        ← implements the shared sink interface on the registry
  healthCollector.ts ← 60s single-flight loop: snapshot + Redis depths → gauges; caches last good
  readiness.ts       ← DB ping / Redis ping / consumer heartbeat, each with a hard timeout
  statusSummary.ts   ← pure: (collector cache, runtime state, readiness) → /status JSON
  healthServer.ts    ← /health, /ready, /metrics, /status routing (replaces inline server in index.ts)
```

### 1. Shared metrics layer: `shared/services/email/inboundEmailMetrics.ts`

- **Interface.** `InboundEmailMetricsSink` declares one method per event:
  - `queueJob({queue, providerType, outcome})`
  - `jobDuration({queue, providerType, seconds})`
  - `message({providerType, outcome, reason})`
  - `authFailure({providerType, code})`
  - `autoPaused({providerType, code})`
  - `imapListenerError({reason})`
  - `imapWebhookDispatchRetry()`
  - `imapOauthAuthRetry()`
  - `consumerLoopError({queue})`
- **Installation.** The module holds one `let sink = NOOP_SINK`, plus `installInboundEmailMetricsSink(sink)` and `resetInboundEmailMetricsSinkForTests()`.
- **Exported recording functions.** These are `recordQueueJobOutcome`, `observeQueueJobDuration`, `recordMessageOutcome`, `recordAuthFailure`, `recordAutoPause`, `recordImapListenerError`, `recordImapWebhookDispatchRetry`, `recordImapOauthAuthRetry` and `recordConsumerLoopError`. Each one:
  - normalizes its labels through the bounded enums below;
  - calls the sink inside `try/catch`, so a sink error is swallowed and never reaches business code. This matches the "never fatal" rule in `inboundEmailAuthOutcomeRecorder`.
- **Dependencies.** None: no prom-client and no imports. The server and temporal-worker get only a no-op function call.
- **Bounded enums and normalizers** (exported `as const` arrays, which the label test reuses):
  - `provider_type`: `microsoft | google | imap | other`
  - `queue`: `v1 | v2`
  - queue `outcome`: `ack | retry | dlq | reclaim | invalid_payload | skip | defer | stale`. The last two are V2 only.
  - message `outcome`: `created | replied | deduped | quarantined | skipped | failed`
  - message `reason`:
    - `none`
    - the `processInboundEmailInApp` skip and quarantine reasons: `missing_defaults`, `invalid_email_data`, `self_notification`, `notification_loop`, `rule_skip`, `unauthorized_thread_header_sender`
    - queue-level reasons: `provider_inactive`, `provider_paused`, `source_unavailable`, `no_messages_from_pointer`, `processing_record_exists`
    - `error`
    - `other`

    `source_unavailable:<detail>` is reduced to `source_unavailable`.
  - auth `code`: `microsoft:invalid_client`, `microsoft:invalid_grant`, `microsoft:invalid_grant:aadsts50173`, `google:invalid_grant`, `imap:invalid_client`, `imap:invalid_grant`, `imap:authentication_failed`, `other`. Google and IMAP subtypes collapse to their base code (F6).
  - pause `reason`: `manual | tenant_cancelled | auth_failure | other`, from `InboundPauseReason`.
  - IMAP listener error `reason`: `auth | timeout | connection | other`. It is derived from `classifyInboundAuthFailure` plus `normalizeImapError`'s code. Never use the message text.

### 2. Call sites (thin pass-throughs, with no per-site tests)

| Event | Site |
|---|---|
| queue ack / retry / dlq / reclaim / invalid_payload | `unifiedInboundEmailQueue.ts`, next to the existing `inbound_email_queue_{ack,retry,dlq,reclaim,invalid_payload_dlq}` logs. `invalid_payload` has no provider and records `provider_type="other"`. |
| queue skip, job duration, loop error, heartbeat | `UnifiedInboundEmailQueueConsumer.runOnce` / `start` (see §4) |
| V2 equivalents | `unifiedInboundEmailQueueV2.ts` ack / retry / dlq / defer / reclaim / stale and `UnifiedInboundEmailQueueConsumerV2`, with `queue="v2"` |
| message outcome (V1) | `unifiedInboundEmailQueueJobProcessor.ts`. Record after `processInboundEmailInApp` returns (~:1044), and `failed` in its catch. Record `deduped/processing_record_exists` where `insertProcessingRecord` returns false. Record the gated and `source_unavailable` skips at their returns. |
| message outcome (V2) | `inboundEmailCoreProcessor.ts:323`, recorded **after** the durable transaction commits, so a rollback cannot over-count |
| auth failure + auto-pause | `EmailProviderLifecycleService.recordUnrecoverableAuthFailure` only (F2). Use `row.provider_type`. Count every call, including on an already-paused row; to do that, extend the early return to carry `providerType`. |
| IMAP listener error | `emailService.ts`, at the `folder_listener_error` stateLog (:1181) |
| IMAP webhook retry | `emailService.ts`, at the `webhook_retry` stateLog (:281) |
| IMAP OAuth auth retry | `unifiedInboundEmailQueueJobProcessor.ts:674` (`imap_oauth_auth_retry`) |

The V1 and V2 message-outcome sites are the same shape. Mark them `// LEVERAGE: pattern inbound-message-outcome-metric`.

### 3. Registry inside email-service: `observability/registry.ts`

- **Library.** prom-client `^15`, added only to `services/email-service/package.json`. The workspace install already covers the Dockerfile (`COPY services/email-service/package.json` → `npm install`).
- **Registry instance.** Use a `new Registry()` instance rather than the global default, so tests can build isolated registries. Call `collectDefaultMetrics({ register })` for `process_*` and `nodejs_*`.
- **Event metrics** (counters, plus one histogram):
  - `alga_inbound_email_queue_jobs_total{queue,provider_type,outcome}`
  - `alga_inbound_email_job_duration_seconds{queue,provider_type}`, a histogram with buckets `[0.1,0.25,0.5,1,2.5,5,10,30,60,90,120]`. 90s is the job timeout.
  - `alga_inbound_email_messages_total{provider_type,outcome,reason}`
  - `alga_inbound_email_auth_failures_total{provider_type,code}`
  - `alga_inbound_email_provider_auto_paused_total{provider_type,code}`
  - `alga_inbound_email_imap_listener_errors_total{reason}`
  - `alga_inbound_email_imap_webhook_dispatch_retries_total`
  - `alga_inbound_email_imap_oauth_auth_retries_total`
  - `alga_inbound_email_consumer_loop_errors_total{queue}`
- **Live gauges** (`collect()` callbacks that read in-process state, so no DB access):
  - `alga_inbound_email_imap_active_listeners`: connected folder listeners
  - `alga_inbound_email_imap_providers_leased`: `EmailService.workers.size`
  - `alga_inbound_email_consumer_last_tick_timestamp_seconds{queue}`
  - `alga_inbound_email_service_info{durable_mode}`: set to 1. `durable_mode` is one of `off | shadow | enforce`.
- **Fleet gauges** (set by the collector):
  - `alga_inbound_email_providers{provider_type,status}`: active providers, any pause state
  - `alga_inbound_email_providers_paused{provider_type,reason,code}`
  - `alga_inbound_email_providers_auth_failing{provider_type,code}`: `inbound_auth_failure_count > 0` and not paused. This is the early signal for the secret rotation. It also catches failures recorded in temporal-worker.
  - `alga_inbound_email_microsoft_subscriptions{state}`. `state` is one of `healthy | expiring_lt_12h | expired | missing`.
  - `alga_inbound_email_microsoft_delivery_mode{mode}`. `mode` is `webhook` or `polling`.
  - `alga_inbound_email_microsoft_webhooks_silent`: `webhook_silent_runs > 0`
  - `alga_inbound_email_gmail_watches{state}`. `state` is one of `healthy | expiring_lt_12h | expired | missing`.
  - `alga_inbound_email_oldest_liveness_age_seconds{provider_type}`. This takes the place of the brief's `oldest_last_sync_age_seconds` (F3).
  - `alga_inbound_email_providers_sync_stale{provider_type}`
  - `alga_inbound_email_queue_depth{queue,state}`. `state` is one of `ready | processing | inflight | dlq | delayed`; `delayed` is V2 only.
  - These four are only emitted when durable mode is not `off`:
    - `alga_inbound_email_durable_inbox{status}`. `status` is one of `processing | retryable_failed | terminal_failed`. `succeeded` is excluded because counting it means scanning an ever-growing table.
    - `alga_inbound_email_durable_outbox_pending`
    - `alga_inbound_email_durable_oldest_pending_outbox_age_seconds`
    - `alga_inbound_email_durable_artifacts_pending`
  - `alga_inbound_email_health_collector_last_success_timestamp_seconds`
  - `alga_inbound_email_health_collector_last_duration_seconds`
  - `alga_inbound_email_health_collector_failures_total`
- **Sink installation.** `promSink.ts` implements `InboundEmailMetricsSink` on top of these counters. `index.ts` installs it **before** the IMAP service and consumers start.

### 4. Consumer heartbeat and loop resilience (F1)

Apply this to both `UnifiedInboundEmailQueueConsumer` and `...V2`:

- **Error handling.** `start()` wraps each `runOnce()` in `try/catch`. On error it logs `event: 'inbound_email_queue_consumer_loop_error'`, calls `recordConsumerLoopError`, and backs off exponentially from 1s up to 30s, resetting after a success. The `process.exit(1)` in `index.ts` stays as a last resort, for a rejection that escapes this.
- **Heartbeat.** A public getter `lastSuccessfulTickAt: number | null` is set after every `runOnce()` that completes without throwing. That includes an empty poll, which takes ~1.25s when idle.
- **Staleness threshold.** It is `handleJobTimeoutMs + 30s`, which is 120s by default, because a legitimately long job holds the tick for up to the 90s timeout. It is exposed as `heartbeatStaleAfterMs`.
- **Redis offline queue.** While Redis is down, node-redis can queue commands without bound, so `runOnce` may hang rather than throw. The heartbeat handles both cases. The implementer must confirm in the dev stack which one happens. Do not change Redis client options in this card.

### 5. Fleet snapshot: `shared/services/email/inboundEmailHealthSnapshot.ts`

`collectInboundEmailHealthSnapshot({ knex, now, thresholds, includeDurable })` returns a tenant-free object of numbers keyed by bounded labels. It is pure apart from the knex queries, so it can be tested against a DB.

- **Query pattern.** Cross-tenant access follows the existing pattern: `tenantDb(knex, 'inbound-email-health-collector').unscoped(..., '<reason>')` and `tenantJoin(..., { rootTenantColumn: 'ep.tenant' })`, as in `emailService.ts:1415` and `EmailWebhookMaintenanceService.ts:296`. Every query is `GROUP BY` bounded columns. The tenant column never appears in the select list.
- **Query set** (one round per collection):
  1. **providers:** `email_providers` where `is_active`, grouped by `provider_type, status`.
  2. **paused:** `inbound_paused_at IS NOT NULL`, grouped by `provider_type, inbound_pause_reason, inbound_auth_failure_code`. Codes are normalized in JS and the counts re-summed after normalization.
  3. **auth-failing:** `is_active AND inbound_paused_at IS NULL AND inbound_auth_failure_count > 0`, grouped by `provider_type, inbound_auth_failure_code`.
  4. **Microsoft:** join `microsoft_email_provider_config` on (tenant, id), filtered to active and unpaused. **No status filter (F4).**
     - Count by `delivery_mode`.
     - For `delivery_mode = 'webhook'`, compute the subscription state with a CASE: `webhook_expires_at IS NULL` → `missing`, `< now` → `expired`, `< now + 12h` → `expiring_lt_12h`, else `healthy`.
     - Count `webhook_silent_runs > 0`.
  5. **Gmail:** join `google_email_provider_config`, active and unpaused. Compute the watch state from `watch_expiration` with the same CASE.
  6. **Liveness (F3):** active, unpaused, `status <> 'disconnected'`. The liveness timestamp depends on provider type:
     - imap: `ep.last_sync_at`, which is updated on every sync loop;
     - microsoft: `GREATEST(ep.last_sync_at, mpc.last_reconciliation_at, mpc.last_webhook_delivery_at)`;
     - google: `GREATEST(ep.last_sync_at, gpc.last_push_received_at)`.

     Per type, return the max age (`now - liveness`; NULL liveness counts as age since `ep.created_at`) and the count above that type's threshold.
     **The implementer must verify** that Microsoft reconciliation advances `last_reconciliation_at` for webhook-mode providers too, not only polling ones; check the reconcile loop around `EmailWebhookMaintenanceService.ts:690-735`. If it doesn't, use `last_webhook_delivery_at` for webhook mode, and record the decision in the code comment.
  7. **Durable** (only when `includeDurable`): `inbound_email_inbox` grouped by status, restricted to the three non-terminal-success statuses; `inbound_email_outbox` pending count and `min(created_at)`; `inbound_email_artifacts` pending count. This is the cross-tenant counterpart of `computeInboundEmailDiagnostics`. That function stays per-tenant and is not called in a loop. Skip mirror lag, because its NOT EXISTS across tenants is too expensive to run every minute.
- **Query timeout.** All queries run in one read transaction with `SET LOCAL statement_timeout = '10s'`, so a slow Citus plan cannot pile up.
- **Thresholds** (env-overridable; the defaults are enough on their own):

| Setting | Env | Default |
|---|---|---|
| collect interval | `EMAIL_SERVICE_HEALTH_COLLECT_INTERVAL_MS` | 60000 |
| stale, imap | `EMAIL_SERVICE_SYNC_STALE_SECONDS_IMAP` | 3600 |
| stale, microsoft | `EMAIL_SERVICE_SYNC_STALE_SECONDS_MICROSOFT` | 7200 |
| stale, google | `EMAIL_SERVICE_SYNC_STALE_SECONDS_GOOGLE` | 86400 (a quiet Gmail mailbox has no liveness signal besides push) |
| expiring window | — | 12h |

### 6. Collector: `services/email-service/src/observability/healthCollector.ts`

- **Run loop.** Runs on start, then every interval with jitter. It is single-flight: a tick is skipped while the previous one is still running.
- **Each tick:**
  - Take the DB snapshot (§5).
  - Read Redis depths for the V1 keys from `getUnifiedInboundEmailQueueConfig()`: `LLEN` ready, `LLEN` processing, `HLEN` inflight hash, `LLEN` dlq.
  - When durable mode is not `off`, also read the V2 keys from `getUnifiedInboundEmailQueueV2Config()`, adding `ZCARD` delayed.
  - Use the existing clients: `getInboundEmailRedisClient()` and `getInboundEmailDurableRedisClient()`. Each Redis read has a 2s timeout.
  - On success, reset each fleet gauge, set the new values, and stamp `last_success`. Reset matters because a label set that has dropped to zero must read 0, not keep its last value.
- **Partial failure.** The DB part and the Redis part fail independently. A part that fails keeps its last values. A failed tick increments `collector_failures_total`, logs `event: 'inbound_email_health_collector_failed'`, and **never throws**.
- **Cached snapshot.** The collector keeps the last good snapshot, its timestamp, and a short history of DLQ depth (the last 60 samples, ~1h) for `/status` to use.
- **Replicas.** The gauges are identical on every replica, so alert queries use `max()`. No leader election. The Helm default is `replicaCount: 1`, and the appliance runs one replica.

### 7. HTTP surface (port 8080, cluster-internal): `observability/healthServer.ts`

This replaces the inline server in `index.ts:85-104`. The routes match on `req.url` path only, ignoring the query string.

| Route | Behavior |
|---|---|
| `/health` | Unchanged: always 200 `ok`. No I/O. |
| `/ready` | Runs these checks concurrently, each with a 2s timeout:<br>• DB: `select 1` through `getAdminConnection()`<br>• Redis: `PING` on the V1 client<br>• V1 consumer heartbeat: fresher than `heartbeatStaleAfterMs`<br>• V2 heartbeat: the same check, only when durable mode is on<br>Returns 200 `{status:'ready', checks}` or 503 `{status:'not_ready', checks}`. Each check is `{ok, latencyMs?, error?}`, and `error` is a short fixed string such as `timeout`, `refused` or `stale`. While starting up (no tick yet, within the first 60s) the heartbeat check passes with `starting:true`. |
| `/metrics` | `registry.metrics()` with `registry.contentType`. Returns 404 when `EMAIL_SERVICE_METRICS_ENABLED=false`. Does no DB or Redis I/O per request. |
| `/status` | **Always 200** when the handler runs. The verdict is in the body. Some appliance readers use `kubectl get --raw`, which drops the body on a non-2xx response; that is why the status is not in the HTTP code. Runs the readiness checks (reusing the result if it is less than 5s old) and combines them with the collector cache through the pure `buildStatusSummary()`. |

`/status` body (schema `version: 1`):

```json
{
  "version": 1,
  "service": "email-service",
  "status": "ok | degraded | down",
  "generatedAt": "ISO",
  "reasons": [{ "code": "microsoft_subscriptions_expired", "severity": "degraded", "message": "2 Microsoft subscriptions have expired", "count": 2 }],
  "consumer": { "v1": { "lastTickAt": "ISO|null", "ageSeconds": 1, "stale": false }, "v2": null },
  "dependencies": { "db": {"ok": true}, "redis": {"ok": true} },
  "queue": { "v1": { "ready": 0, "processing": 0, "inflight": 0, "dlq": 3, "dlqGrowthLastHour": 0 }, "v2": null },
  "imap": { "activeListeners": 4, "providersLeased": 2 },
  "providers": { "byTypeAndStatus": {}, "paused": [{ "providerType": "microsoft", "reason": "auth_failure", "code": "microsoft:invalid_client", "count": 11 }], "authFailing": [] },
  "microsoft": { "subscriptions": { "healthy": 0, "expiring_lt_12h": 0, "expired": 0, "missing": 0 }, "deliveryMode": { "webhook": 0, "polling": 0 }, "silentWebhooks": 0 },
  "gmail": { "watches": { "healthy": 0, "expiring_lt_12h": 0, "expired": 0, "missing": 0 } },
  "sync": { "stale": { "imap": 0, "microsoft": 0, "google": 0 }, "oldestLivenessAgeSeconds": {} },
  "collector": { "lastSuccessAt": "ISO|null", "ageSeconds": 12, "intervalSeconds": 60 }
}
```

Severity rules. The overall status is the worst severity among the reasons; with no reasons it is `ok`. Every count is fleet-level and never names a tenant.

- **`down`:**
  - DB unreachable;
  - Redis unreachable;
  - V1 (or enabled V2) consumer heartbeat stale.
- **`degraded`:**
  - Microsoft subscriptions `expired` > 0;
  - auth-paused providers > 0, or auth-failing providers > 0;
  - DLQ depth grew within the last hour;
  - ready-queue depth > 500;
  - any stale-sync providers;
  - Gmail watches `expired` > 0;
  - collector last success older than 3× the interval, or never succeeded after 5 minutes of uptime ("health data stale").
- **`info`** (listed, does not change the status): DLQ depth > 0 but not growing; providers in `polling` delivery mode; manual pauses.

### 8. Wiring in `services/email-service/src/index.ts`

1. Build the registry, then install the prom sink before `service.start()`.
2. Start the consumers. Hand the consumer instances and `service` (the `EmailService` instance, for the listener stats) to the health server.
3. Start `healthCollector`, then `healthServer.listen`. A collector failure must never block the listen. The health server should also start **before** the consumers are fully running, so `/health` is up as early as it is today.
4. On shutdown, stop the collector timer.

`EmailService` gains `getListenerStats(): { providersLeased, activeListeners }`. `ImapFolderListener` keeps a `connected` boolean: set it after the `connected` stateLog, and clear it in the catch, the finally and `stop()`.

### 9. Helm (`ee/helm/email-service`)

- **Probes.** Add `readinessProbe.path` (default `/ready`) and `livenessProbe.path` (default `/health`) to `values.yaml`, and use them in `templates/deployment.yaml:269-287`. Readiness goes to `/ready`. Liveness stays `/health`.
- **Metrics block:**

  ```yaml
  metrics:
    enabled: false          # scrape wiring only; /metrics is always served unless EMAIL_SERVICE_METRICS_ENABLED=false
    podAnnotations: true    # prometheus.io/scrape|port|path on the pod when enabled
    serviceMonitor:
      enabled: false
      interval: 30s
      scrapeTimeout: 10s
      labels: {}
  ```

  Add `templates/servicemonitor.yaml`, gated on `metrics.enabled && metrics.serviceMonitor.enabled`. It targets the existing Service port `http`, path `/metrics`.
- **Appliance.** Its values file needs no change. It inherits `metrics.enabled: false` and the new `/ready` readiness path. Readiness on `/ready` is wanted on the appliance too (F8 explains why it is safe).
- **Verification.** Run `helm template` for the default values, `metrics.enabled=true`, and `serviceMonitor.enabled=true`, and for the appliance values file.

### 10. Appliance consumption (F7)

Read `/status` and interpret it with the same rules everywhere:

| `/status` result | Effect |
|---|---|
| `degraded` or `down`, and the Deployment is ready | Component status becomes `degraded`, with the reason messages. Add a `background`-severity blocker, so the rollup becomes `ready_with_background_issues`. Login is never blocked. |
| 404, unreachable, or invalid JSON (version skew with an older image, pod starting) | No change to component health. Note `emailHealth: 'unavailable'` in the diagnostics. |

Sites:

- **`flux/base/platform/appliance-status.yaml`** (in-cluster pod; this feeds the status UI). Add `httpGetJson(url, 3000)` next to `httpProbe`, a GET that parses JSON. It calls `http://email-service.msp.svc.cluster.local:8080/status`. Apply the result to the `email-service` entry in `resources` inside `collectCanonical()` (:749) **before** `backgroundReady` is computed, and add the summary to the result as `emailService`. No RBAC change: this is pod-to-service HTTP, and the appliance has no NetworkPolicies.
- **`host-service/status-engine.mjs`.** Add `emailServiceStatusCommand: ${kubectlPrefix} get --raw /api/v1/namespaces/msp/services/http:email-service:http/proxy/status` to `statusSnapshotCommandContext`. Run it in both collect functions, skipping it when the cluster is unreachable. In `buildStatusSnapshot`, a degraded or down result adds a `background-services` failure summary with the reasons. It also makes `deriveReadiness().backgroundReady` false.
  **RBAC:** add `services/proxy` with `get` to `control-plane/manifests/rbac.yaml`.
- **`operator/lib/status.mjs`.** In `collectStatus`, after the workloads loop, run `kubectl get --raw` the same way. Override the `email-service` component's `status` and `message`. `toCanonicalStatus` then computes `backgroundReady` from it with no other change.
- **`host-service/support-bundle.mjs`.** Capture `cluster/email-service-status.json` and `cluster/email-service-metrics.txt` through the same `get --raw` proxy paths. They go through the existing `redactText`.
- **`status-ui`.** No change needed; it already renders blockers, components and `diag`.

### 11. Out of scope and follow-ups

- No changes to webhook routes in the Next.js server, to temporal-worker metrics, or to the server's OTel reader / `observability/metrics.ts`.
- Auto-pause classification is unchanged. The `code` label already separates `microsoft:invalid_client` (our secret) from `invalid_grant` (customer revoked). Re-classifying `invalid_client` as our fault is a separate card.
- `email_provider_health` is left alone. Follow-up: drop it, or rebuild it on this snapshot.
- Consolidating the three appliance status implementations is a follow-up (`LEVERAGE` marker).
- cloudlab scrape config and PrometheusRules live in nm-kube-config. The suggested rules ship as a doc (below) and go in the PR description.

## Suggested alert rules (doc: `docs/operations/email-service-health-metrics.md`)

Every fleet gauge uses `max()` across replicas.

| Alert | Expr | For |
|---|---|---|
| Microsoft subscriptions expired | `max(alga_inbound_email_microsoft_subscriptions{state="expired"}) > 0` | 30m |
| Our Microsoft app secret is broken | `sum(increase(alga_inbound_email_auth_failures_total{code="microsoft:invalid_client"}[15m])) > 0 or max(alga_inbound_email_providers_auth_failing{code="microsoft:invalid_client"}) > 0` | 5m |
| Auth failures surge (any code) | `max(alga_inbound_email_providers_auth_failing) by (code) >= 3` | 15m |
| DLQ growing | `max(delta(alga_inbound_email_queue_depth{state="dlq"}[1h])) > 0` | 15m |
| Ready backlog | `max(alga_inbound_email_queue_depth{state="ready"}) > 500` | 15m |
| Consumer wedged | `time() - max(alga_inbound_email_consumer_last_tick_timestamp_seconds{queue="v1"}) > 300` | 5m |
| Stale sync | `max(alga_inbound_email_providers_sync_stale) by (provider_type) > 0` | 1h |
| Fleet surge to polling | `max(alga_inbound_email_microsoft_delivery_mode{mode="polling"}) / clamp_min(max(sum(alga_inbound_email_microsoft_delivery_mode)), 1) > 0.5 and max(delta(alga_inbound_email_microsoft_delivery_mode{mode="polling"}[1h])) > 5` | 30m |
| Health collector stale | `time() - max(alga_inbound_email_health_collector_last_success_timestamp_seconds) > 300` | 10m |

The doc also explains the endpoints, the `/status` schema and severity rules, the env knobs, and why fleet gauges use `max()`.

## Files to change

New:

- `shared/services/email/inboundEmailMetrics.ts` (+ `inboundEmailMetrics.test.ts`)
- `shared/services/email/inboundEmailHealthSnapshot.ts`
- `services/email-service/src/observability/{registry,promSink,healthCollector,readiness,statusSummary,healthServer}.ts` (+ colocated `*.test.ts`)
- `server/src/test/integration/inboundEmailHealthSnapshot.integration.test.ts`
- `ee/helm/email-service/templates/servicemonitor.yaml`
- `docs/operations/email-service-health-metrics.md`

Modified:

- `services/email-service/package.json` (prom-client), `package-lock.json`
- `services/email-service/src/index.ts`, `services/email-service/src/emailService.ts`
- `shared/services/email/unifiedInboundEmailQueue.ts`, `unifiedInboundEmailQueueConsumer.ts`, `unifiedInboundEmailQueueV2.ts`, `unifiedInboundEmailQueueConsumerV2.ts`
- `shared/services/email/unifiedInboundEmailQueueJobProcessor.ts`, `inboundEmailCoreProcessor.ts`, `EmailProviderLifecycleService.ts`
- `ee/helm/email-service/values.yaml`, `templates/deployment.yaml`, `README.md`
- `ee/appliance/flux/base/platform/appliance-status.yaml`
- `ee/appliance/host-service/status-engine.mjs`, `host-service/support-bundle.mjs`, `operator/lib/status.mjs`
- `ee/appliance/control-plane/manifests/rbac.yaml`
- Appliance tests: `host-service/tests/status-engine.test.mjs`, `support-bundle.test.mjs`, and the operator status test

## Tests (80/20)

1. **`shared/services/email/inboundEmailMetrics.test.ts`** (unit):
   - recording with the no-op default never throws;
   - an installed sink receives normalized labels;
   - a throwing sink is swallowed;
   - every normalizer maps unknown, tenant-like or free-text input to `other`;
   - `source_unavailable:x` maps to `source_unavailable`, and Google subtypes collapse.
2. **`observability/registry.test.ts`, label-bounding test** (acceptance item). It builds a fresh registry and sink, then drives every recording function with adversarial inputs: UUIDs, emails, error strings, a raw tenant id. It feeds a synthetic snapshot whose source rows carry tenant ids. Then it walks `registry.getMetricsAsJSON()` and asserts:
   - every label name is in the allowed set;
   - every value is in that label's exported enum;
   - no value matches a UUID or email regex.
3. **`healthCollector.test.ts`** (unit, with the snapshot function and Redis injected):
   - success sets the gauges and resets label sets that have dropped to zero;
   - a DB failure keeps the last values, increments failures, leaves `last_success` unchanged, and does not throw;
   - a Redis failure is isolated from the DB part;
   - the loop is single-flight.
4. **`statusSummary.test.ts`** (pure). One table-driven case per severity rule, covering:
   - `ok`;
   - degraded for an expired subscription, auth paused, DLQ growth or a stale collector;
   - down for Redis or a stale heartbeat;
   - DLQ that is non-zero but flat (info only);
   - the shape snapshot, version 1.
5. **`healthServer.test.ts`** (in-process HTTP on an ephemeral port, with injected checks):
   - `/health` returns 200 even when every check fails;
   - `/ready` returns 200 or 503 with the check shapes, and its timeout path works;
   - `/metrics` returns the content type and contains every family name from §3;
   - `/metrics` returns 404 when disabled;
   - `/status` always returns 200 with the body schema.
6. **Consumer resilience** (`unifiedInboundEmailQueueConsumer` unit, extending an existing test file if there is one):
   - after `runOnce` throws, the loop keeps going with backoff;
   - `lastSuccessfulTickAt` does not advance on an error and does advance on an empty poll.
7. **`server/src/test/integration/inboundEmailHealthSnapshot.integration.test.ts`** (test DB; same harness as `inboundAuthFailureAutoPause.integration.test.ts`). Seed two tenants with:
   - a Microsoft webhook provider with `webhook_expires_at` in the past and `status='error'` (counted as expired, F4);
   - a Microsoft webhook provider expiring in 6h;
   - a Microsoft polling provider;
   - a Gmail provider with an expired watch;
   - an IMAP provider with a 2h-old `last_sync_at`;
   - a provider paused with `auth_failure`/`microsoft:invalid_client`;
   - an unpaused provider with `inbound_auth_failure_count=1`;
   - an inactive provider (excluded).

   Assert the exact counts, and that a JSON serialization of the snapshot contains neither tenant id nor provider id.
8. **Appliance:**
   - `status-engine.test.mjs`: a degraded `/status` gives a background failure summary with the reason, and `backgroundReady=false`; a 404 or failing command leaves it unchanged.
   - Operator status test: same.
   - `support-bundle.test.mjs`: the two new captures are present.
   - `appliance-status.yaml`: extend `control-plane-manifests.test.mjs` or the equivalent to assert the email-service status read exists.
9. **Helm:** `helm template` for each combination in §9 (scripted check or manual).

## Acceptance walk-through (dev compose stack, `alga-psa-local-test`)

1. **Rebuild and check the endpoints.** Rebuild email-service. Then:
   - `docker exec <email-service> wget -qO- localhost:8080/metrics` lists every family from §3;
   - `/status` → `"status":"ok"`;
   - `/ready` → 200.
2. **Stop Redis.** `/ready` → 503 (redis, then the heartbeat). `/status` → `down`, or `degraded` if the check order differs. `/health` stays 200, and the container does not restart. Start Redis again: everything recovers with no restart.
3. **Expired subscription.** Set a connected Microsoft webhook provider's `webhook_expires_at` to the past. Within one collector interval, `microsoft_subscriptions{state="expired"}` reads 1 and `/status` is degraded with `microsoft_subscriptions_expired`.
4. **`invalid_client`.** Point a Microsoft provider at a bad client secret (or use algasim token fault injection) and let one job fail. `auth_failures_total{provider_type="microsoft",code="microsoft:invalid_client"}` increments and `providers_auth_failing` reads 1.
5. **End-to-end message.** Send one message through GreenMail/IMAP (`alga-inbound-email-testing` skill). `messages_total{provider_type="imap",outcome="created",reason="none"}` increments.
6. **Label check.** `grep -E '[0-9a-f]{8}-[0-9a-f]{4}-|@' /metrics` returns nothing.
7. **Appliance.** Run the status engine and operator status units with a stubbed degraded `/status`. If there is time, do a VM smoke test with the `alga-appliance-local` skill.

## Key decisions (summary)

1. prom-client, with its own Registry, only in email-service. Shared code gets a dependency-free sink with a no-op default.
2. Auth-failure and auto-pause metrics are recorded once, inside `recordUnrecoverableAuthFailure` (F2).
3. The consumer loop no longer crashes or hangs silently on a Redis error. A successful-tick heartbeat drives `/ready` (F1).
4. `/status` always returns HTTP 200 with the verdict in the body (needed for kubectl proxy readers). `/ready` carries HTTP semantics. `/health` is unchanged.
5. The expired-subscription gauge ignores `status` (F4). Staleness uses a per-type liveness timestamp with per-type thresholds (F3).
6. Two gauges were added beyond the brief, both DB-derived: `providers_auth_failing`, which fires on the first failure of a secret rotation, before auto-pause; and `microsoft_webhooks_silent`.
7. On the appliance: the in-cluster status pod reads `/status` over HTTP; host-service and the operator read it through the API-server service proxy (new `services/proxy` RBAC); the support bundle captures `/status` and `/metrics`. Version skew (404) never degrades.
8. Fleet gauges use `max()` in alerts. No leader election.
