# Workflow Worker Helm Chart

This Helm chart deploys the Workflow Worker component for the Alga PSA application. The worker processes workflow events from Redis Streams and exposes a health endpoint for Kubernetes probes.

## Default Namespace

- This chart defaults to installing into the `msp` namespace via `values.yaml` (`namespace: msp`).
- You can override with `--namespace` or by setting `values.namespace`.

## Install

- Basic install into `msp`:

```
helm install workflow-worker ee/helm/workflow-worker/ -n msp --create-namespace
```

- With overrides:

```
helm install workflow-worker ee/helm/workflow-worker/ \
  -n msp \
  -f my-values.yaml
```

## Key Values

- `image.repository`, `image.tag`: Set to your built workflow-worker image.
- `db.*`: Database host/port/credentials for app user.
- `workflow.redis.*`: Redis connection settings and stream configuration.
- `secrets.*`: App secrets (used if `vault.enabled=false`).
- `service.port`: Port used for health/metrics (defaults `4000`).

## Health Probes

- Liveness/Readiness check `GET /health` on `service.port`.

## Notes

- The chart can optionally integrate with Vault (`values.vault.*`) to inject secrets.
- If not using Vault, ensure the referenced DB and Redis secrets exist in the `msp` namespace or adjust `values.yaml` accordingly.

