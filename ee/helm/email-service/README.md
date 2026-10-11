# IMAP Service Helm Chart

Deploys the AlgaPSA IMAP inbound email listener service.


## Probes and metrics

- `livenessProbe.path` (default `/health`) is an unconditional 200 with no I/O.
- `readinessProbe.path` (default `/ready`) fails only when the database or Redis is unreachable or the queue consumer has stopped making progress. Fleet-health conditions (expired subscriptions, paused providers, ...) never affect readiness; they are reported on `/status`.
- The pod always serves Prometheus metrics on `/metrics` (set `EMAIL_SERVICE_METRICS_ENABLED=false` to return 404) and a JSON health summary on `/status`.
- `metrics.enabled` (default `false`) only adds scrape discovery: `prometheus.io/*` pod annotations (`metrics.podAnnotations`) and, with `metrics.serviceMonitor.enabled`, a `ServiceMonitor` (needs the Prometheus Operator CRDs).

See `docs/operations/email-service-health-metrics.md` for the metric catalogue and suggested alert rules.
