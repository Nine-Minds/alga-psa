# Email-service inbound health metrics

Work order alga0002256. Plan: `docs/plans/2026-10-10-email-service-health-metrics-plan.md`.

The email-service exposes inbound email health on its existing health port (default `8080`).
Nothing here needs an external service, a push target or a new env var to work: the endpoints
are always served, and `/metrics` is on by default.

## Endpoints

| Path | Purpose | Failure behaviour |
|---|---|---|
| `/health` | Liveness. Unconditional `200`. The Helm `livenessProbe` stays here. | Never fails. |
| `/ready` | Readiness. Helm `readinessProbe`. Checks DB (`select 1`), Redis (`ping`) and the consumer heartbeats, each with a hard timeout. | `503` with a per-check JSON body. Fixed error strings only: `timeout`, `refused`, `stale`, `starting`, `error`. |
| `/metrics` | Prometheus text exposition from a dedicated registry. | `404` when `EMAIL_SERVICE_METRICS_ENABLED=false`. |
| `/status` | Human/appliance summary. Always HTTP `200`. | A failure to build the summary is reported in the body (`status: "down"`, reason `status_unavailable`), never as a non-200. |

`/ready` fails **only** on DB down, Redis down or a wedged consumer (heartbeat older than the
stale limit; a 60s startup grace reports `starting`). Fleet-health conditions (expired
subscriptions, paused providers, backlog, ...) are deliberately **not** readiness failures: pulling
pods out of service would not fix them and would stop the healthy providers. They appear on
`/status` and in the metrics only.

## Configuration

| Env var | Default | Effect |
|---|---|---|
| `EMAIL_SERVICE_METRICS_ENABLED` | `true` | `false` makes `/metrics` return `404`. |
| `EMAIL_SERVICE_HEALTH_COLLECT_INTERVAL_MS` | `60000` | Fleet collector period (jittered ±10%). |
| `EMAIL_SERVICE_SYNC_STALE_SECONDS_IMAP` | `3600` | Stale-sync threshold for IMAP. |
| `EMAIL_SERVICE_SYNC_STALE_SECONDS_MICROSOFT` | `7200` | Stale-sync threshold for Microsoft. |
| `EMAIL_SERVICE_SYNC_STALE_SECONDS_GOOGLE` | `86400` | Stale-sync threshold for Google. |

Helm (`ee/helm/email-service`): the `metrics` block defaults to **off**.

- `metrics.enabled=true` with `metrics.podAnnotations=true` adds `prometheus.io/scrape|port|path` pod annotations.
- `metrics.serviceMonitor.enabled=true` (also requires `metrics.enabled`) renders a `ServiceMonitor`.
- The readinessProbe path is `/ready`; the livenessProbe path is `/health`.

## Fleet collector

Fleet gauges (providers, subscriptions, queue depth, durable backlog, ...) are produced by a
single-flight background loop, not per scrape. A tick never throws. On failure the previous values
are kept, `alga_inbound_email_health_collector_failures_total` is incremented and
`..._last_success_timestamp_seconds` is left unchanged. The DB part and the Redis part fail
independently; a tick counts as a success only when both succeed.

Because every replica computes the same cluster-wide numbers, **fleet gauges are identical on every
replica**. Alert queries therefore aggregate with `max()` (never `sum()`), which makes the result
independent of replica count and avoids double counting. There is no leader election.

## `/status` schema (version 1)

```json
{
  "version": 1,
  "status": "ok | degraded | down",
  "reasons": [{ "code": "...", "severity": "down | degraded | info", "message": "..." }],
  "checks": { "db": {}, "redis": {}, "consumer_v1": {}, "consumer_v2": {} },
  "...": "plus provider/queue/IMAP summaries; no tenant ids, provider ids or mailboxes"
}
```

Severity rules (reasons are sorted worst first; overall status is the worst severity present):

- **down**: `db_unreachable`, `redis_unreachable`, `consumer_v1_stale`, `consumer_v2_stale`.
- **degraded**: `microsoft_subscriptions_expired`, `providers_auth_paused`, `providers_auth_failing`,
  `sync_stale`, `gmail_watches_expired`, `dlq_growing`, `queue_backlog` (ready > 500),
  `health_data_stale` (older than 3x the collect interval, or never succeeded after 5 minutes).
- **info** (does not change `status`): `dlq_nonzero`, `microsoft_polling_providers`, `providers_paused_manual`.

### Appliance

On the appliance the status engine, the operator and the in-cluster status pod read `/status`
(through the API-server service proxy, or directly from the pod). `degraded`/`down` marks the
background tier as needing attention (`ready_with_background_issues`); it never affects the login
tier. A `404`, unreachable service, invalid JSON or `version != 1` is treated as *unavailable* and
does **not** degrade the appliance status (older email-service images have no `/status`). The
control-plane ClusterRole gains `services/proxy` with verb `get` for this. Support bundles capture
`cluster/email-service-status.json` and `cluster/email-service-metrics.txt`.

## Metric catalogue

All names are prefixed `alga_inbound_email_`. Labels are bounded enums only (provider_type, outcome,
reason, code, queue, state, status, mode, durable_mode). No tenant id, provider id, mailbox or
free-text error is ever a label; unknown values collapse to `other`. `code` is limited to an
allowlist (`microsoft:invalid_client`, `microsoft:invalid_grant`, `microsoft:invalid_grant:aadsts50173`,
`google:invalid_grant`, `imap:invalid_client`, `imap:invalid_grant`, `imap:authentication_failed`,
`other`, plus `none` on the paused gauge).

Counters (per replica, use `sum(increase(...))`):

- `queue_jobs_total{queue,provider_type,outcome}`, `job_duration_seconds{queue,provider_type}` (histogram)
- `messages_total{provider_type,outcome,reason}`
- `auth_failures_total{provider_type,code}`, `provider_auto_paused_total{provider_type,code}`
  (recorded once, in `EmailProviderLifecycleService.recordUnrecoverableAuthFailure`)
- `imap_listener_errors_total{reason}`, `imap_webhook_dispatch_retries_total`, `imap_oauth_auth_retries_total`
- `consumer_loop_errors_total{queue}`
- `health_collector_failures_total`

Per-replica gauges: `imap_active_listeners`, `imap_providers_leased`,
`consumer_last_tick_timestamp_seconds{queue}`, `service_info{durable_mode}`.

Fleet gauges (identical across replicas; use `max()`): `providers{provider_type,status}`,
`providers_paused{provider_type,reason,code}`, `providers_auth_failing{provider_type,code}`,
`microsoft_subscriptions{state}`, `microsoft_delivery_mode{mode}`, `microsoft_webhooks_silent`,
`gmail_watches{state}`, `oldest_liveness_age_seconds{provider_type}`,
`providers_sync_stale{provider_type}`, `queue_depth{queue,state}`, `durable_inbox{status}`,
`durable_outbox_pending`, `durable_oldest_pending_outbox_age_seconds`, `durable_artifacts_pending`,
`health_collector_last_success_timestamp_seconds`, `health_collector_last_duration_seconds`.

Semantics worth knowing:

- Expired Microsoft subscriptions count providers with `is_active AND inbound_paused_at IS NULL AND delivery_mode='webhook'`
  and an expired `webhook_expires_at`; `email_providers.status` is not consulted (so `error` rows still count),
  except that `configuring` rows (setup never finished) are excluded.
- Stale sync counts providers that are active, unpaused, and whose status is not `configuring` or `disconnected`
  (so `error` still counts). `configuring` rows are also excluded from `microsoft_delivery_mode`,
  `microsoft_subscriptions` and `gmail_watches`. It uses a per-type liveness timestamp (IMAP `last_sync_at`; Microsoft
  `GREATEST(last_sync_at, last_reconciliation_at, last_webhook_delivery_at)`; Google
  `GREATEST(last_sync_at, last_push_received_at)`) against the per-type thresholds above.
- **Known limitation:** with durable mode `enforce`, Microsoft `last_reconciliation_at` only advances when
  messages are staged, so a quiet mailbox's liveness can age and may appear in `providers_sync_stale`
  without being broken.

## Suggested alert rules

Every fleet gauge uses `max()` across replicas. These are suggestions; the cloudlab
PrometheusRules live in nm-kube-config and are not part of this change.

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

Note: the "consumer wedged" rule uses `max()` of the last-tick timestamp, so it fires only when
*all* replicas have stopped ticking; a single wedged replica is caught by `/ready` (the pod is
removed from service) and by `consumer_loop_errors_total`.
