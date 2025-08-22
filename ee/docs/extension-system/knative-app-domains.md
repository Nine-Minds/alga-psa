# Per-Extension App Domains (Knative) — Ops & RBAC

This document captures the operational pieces needed to support per-install application domains using Knative DomainMapping, provisioned by the Temporal worker.

Scope: We track changes here; the actual Helm/Kubernetes wiring is handled in the infra repo.

## Environment Variables

- Temporal worker
  - `EXT_DOMAIN_ROOT`: Root wildcard domain for extension apps (e.g., `ext.example.com`).
  - `RUNNER_NAMESPACE`: Kubernetes namespace where the Runner KService lives (defaults to `default`).
  - `RUNNER_KSERVICE`: Name of the Knative Service for the Runner (defaults to `runner`).
  - Standard Temporal env: `TEMPORAL_ADDRESS`, `TEMPORAL_NAMESPACE`, `TEMPORAL_TASK_QUEUE`.

- Runner KService
  - `BUNDLE_STORE_BASE`: Base URL for bundle objects (e.g., `http://minio:9000/alga-ext/`).
  - `REGISTRY_BASE_URL`: Base URL of the EE server (used for host lookup + validation).
  - `EXT_CACHE_MAX_BYTES`: Optional cache/file size limit for static assets.
  - `EXT_STATIC_STRICT_VALIDATION`: `true|false` to enforce strict tenant/contentHash validation.
  - `EXT_EGRESS_ALLOWLIST`: Optional comma-separated host allowlist for guest HTTP egress.
  - S3/MinIO creds if needed by origin access (typically not needed if using HTTP gateway with public read): `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET`.

## DNS / Ingress

- Configure wildcard DNS: `*.${EXT_DOMAIN_ROOT}` to Knative Ingress.
- If not using wildcard, automate DNS records for each provisioned domain.

## RBAC (Temporal Worker ServiceAccount)

Grant the Temporal worker permission to manage DomainMappings in the target namespace:

```
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: temporal-worker-knative
  namespace: ${RUNNER_NAMESPACE}
rules:
  - apiGroups: ["serving.knative.dev"]
    resources: ["domainmappings"]
    verbs: ["get", "list", "watch", "create", "patch", "update"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: temporal-worker-knative
  namespace: ${RUNNER_NAMESPACE}
subjects:
  - kind: ServiceAccount
    name: temporal-worker
    namespace: ${TEMPORAL_WORKER_NAMESPACE}
roleRef:
  kind: Role
  apiGroup: rbac.authorization.k8s.io
  name: temporal-worker-knative
```

Ensure the Temporal worker Deployment/Pod uses `serviceAccountName: temporal-worker` and set environment variables `RUNNER_NAMESPACE`, `RUNNER_KSERVICE`, `EXT_DOMAIN_ROOT`.

## Temporal Activity Behavior

- `computeDomain(tenantId, extensionId, EXT_DOMAIN_ROOT)` returns `${t8}--${e8}.${EXT_DOMAIN_ROOT}` where:
  - `t8` is the first 8 hex chars if `tenantId` looks like a UUID, otherwise first 12 slug chars
  - `e8` is calculated similarly for `extensionId`
  - Rationale: keep `metadata.name` within Kubernetes 63-char limit for DomainMapping resources.
- `ensureDomainMapping({ domain, namespace, kservice })`:
  - Preflight checks:
    - Verifies Knative Service exists: `serving.knative.dev/v1`, resource `services`, name `${kservice}` in `${namespace}`
    - Ensures ClusterDomainClaim exists for `${domain}` (`networking.internal.knative.dev/v1alpha1`).
      - If env `KNATIVE_AUTO_CREATE_CDC=true`, the worker attempts to create the CDC.
      - Otherwise, it fails with a clear message including a ready-to-apply CDC manifest.
  - Creates or patches `DomainMapping`:
    - `apiVersion: serving.knative.dev/v1beta1`, `kind: DomainMapping`, `metadata.name: ${domain}`
    - `spec.ref: { apiVersion: 'serving.knative.dev/v1', kind: 'Service', name: ${kservice} }`
- On success, status in DB is updated to `{ state: 'ready' }` and `runner_ref` stores a small reference object.

## Runner

- Exposes `GET /` which reads Host → calls `REGISTRY_BASE_URL/api/installs/lookup-by-host` (API wrapper around the `installs.lookupByHost` server action) → redirects to `/ext-ui/{extensionId}/{content_hash}/index.html`.
- Continues to enforce strict validation in `/ext-ui` route via `/api/installs/validate`.

## Next.js (EE Server)

- Server actions-first (business logic):
  - `installs.lookupByHost(host: string)` → `{ tenant_id, extension_id, content_hash }`.
  - `installs.validate(tenant: string, extension: string, hash: string)` → `{ valid: boolean }`.
  - `installs.provisionDomain(installId: string)` / `installs.reprovision(installId: string)` → triggers Temporal workflow.
- Thin API wrappers for external consumers (delegate to actions only):
  - `GET /api/installs/lookup-by-host?host=...`
  - `GET /api/installs/validate?tenant=...&extension=...&hash=...`
  - `POST /api/installs/:id/reprovision`

### Lookup and Validate Contracts

- LookupByHost response: `{ tenant_id: string, extension_id: string, content_hash: string }`.
- Validate response: `{ valid: boolean }`.

## Helm Values Hints (Infra Repo)

- temporal-worker chart:
  - `serviceAccount.name: temporal-worker`
  - env:
    - `RUNNER_NAMESPACE: <ns>`
    - `RUNNER_KSERVICE: runner`
    - `EXT_DOMAIN_ROOT: ext.example.com`
    - `KNATIVE_AUTO_CREATE_CDC: "true"` (optional; requires ClusterRole to manage ClusterDomainClaims)
  - RBAC templates include Role/RoleBinding above when enabled.

## RBAC for ClusterDomainClaim (optional)

To auto-create ClusterDomainClaims, grant the Temporal worker a ClusterRole with read/create/patch on `clusterdomainclaims.networking.internal.knative.dev` and bind it via ClusterRoleBinding to the worker ServiceAccount.

---
Change history: Introduced with per-install app domains (Plan 1.f).
