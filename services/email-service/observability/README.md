# Email service (IMAP) — Grafana monitoring

`grafana-dashboard.json` is the Grafana dashboard for the inbound IMAP email
service (`services/email-service`). It watches the service's logs and the metrics
we can derive from them.

## Where it runs

The dashboard lives in the **AlgaPSA** folder of the cloudlab Grafana at
<https://logs.9minds.ai/d/alga-email-service-imap>. It reads from the **Loki**
datasource (`loki-datasource`), stream `{namespace="msp", container="email-service"}`.

This is logs-first by design: the service emits no Prometheus metrics yet, so every
panel is built from log lines. The structured signal is the single-line
`[IMAP_SM] {json}` state-machine events the service writes (see `stateLog()` in
`../src/emailService.ts`). The human `[IMAP] …` pino lines pretty-print objects across
multiple Loki lines, so the curated error panel anchors on the `[IMAP]`/`[IMAP_SM]`
prefixes to skip that multi-line noise.

## What it shows

- **Overview** — active providers now, messages synced, sync cycles, error events,
  lease losses, provider-refresh errors (over the dashboard range).
- **Throughput & provider pool** — messages synced and sync cycles per interval;
  active providers/workers vs candidate providers loaded from the DB.
- **Health & connection lifecycle** — error/warning events by type; connects, server
  BYEs, folder-listener and worker start/stop, OAuth refreshes.
- **Lease / HA coordination** — lease acquire/lost/skip across the replicas, plus a
  per-tenant + folder activity table.
- **All `[IMAP_SM]` events by type**, then three log panels: live stream,
  decoded state-machine events, and a curated errors/warnings feed.

Variables: `$pod` (scope to a replica, defaults to all) and `$search` (free-text
filter for the log panels — e.g. a `providerId`, `tenant`, or `sync_complete`).

## Re-import after editing

Edit `grafana-dashboard.json`, then POST it to Grafana (in-cluster, no SSO):

```bash
jq -n --argjson d "$(cat grafana-dashboard.json)" \
  '{dashboard:$d, folderUid:"af8tin50sl9mof", overwrite:true}' > /tmp/p.json
# from a pod that can reach the cluster service:
curl -s -u admin:admin123 -H 'Content-Type: application/json' -X POST \
  http://grafana-service.grafana.svc.cluster.local:3000/api/dashboards/db \
  --data-binary @/tmp/p.json
```

The dashboard `uid` (`alga-email-service-imap`) is stable, so re-imports update in
place. See the `alga-log-analysis` skill for the curl-pod access pattern.

## Next step: real metrics

When we want true metrics (queue depth, processing latency, error rate, IMAP
connection/lease gauges), instrument `services/email-service` with a Prometheus
`/metrics` endpoint and add a Prometheus-backed row here. The log-derived panels stay
useful as a cross-check.
