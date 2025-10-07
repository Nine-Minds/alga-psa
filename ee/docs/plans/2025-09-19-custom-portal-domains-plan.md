Title: Customer Portal Custom Domains – Design & Implementation Plan
Date: 2025-09-19

Overview / Rationale
- Goal: Enable enterprise tenants to surface portal traffic on a vanity hostname while preserving seamless operation for CE tenants who remain on the default fleet domains.
- Approach: Tenants create a DNS CNAME that targets a canonical host we control (`<tenant7>.portal.algapsa.com`). We manage lifecycle state, DNS verification, and Istio configuration via Temporal so the portal can respond on both the canonical host and any approved vanity CNAMEs.
- Success Criteria: Exactly one active domain per tenant, accurate status visibility in the Client Portal settings UI, automated Istio/cert-manager reconciliation, and resilient observability hooks (OpenTelemetry traces, PostHog metrics) around the workflow.
- Non-goals: Supporting multiple domains per tenant, delegating DNS into customer zones, or replacing cert-manager.

Key Decisions & Clarifications
- Canonical target: Store `<first 7 chars of tenant_id>.portal.algapsa.com` in the database so DNS guidance remains stable even if tenant metadata shifts.
- Certificates: Re-use the existing wildcard `*.portal.algapsa.com` certificate for the canonical ingress path. Vanity domains CNAME to the canonical host; cert-manager issues per-domain certificates through ACME using HTTP-01, leveraging our ingress path. No new Route53 zones required.
- Reconciliation: Temporal activity generates desired manifests, writes them into the `nm-kube-config/alga-psa` repo, applies via `kubectl`/Helm, and commits back to Git for auditability (no standalone operator).
- Istio config source: `nm-kube-config/alga-psa` is the single source of truth; the activity rewrites YAML based on DB state, ensuring every change is versioned prior to applying in-cluster.
- Observability: Use our existing OpenTelemetry setup for workflow/activity spans and PostHog for counters and timings.
- Security: Gate all settings actions with RBAC (tenant admins only) and audit via existing logging helpers.

Current State Snapshot
- UI: CE build now shows the canonical hosted domain with an Enterprise badge; EE build ships a fully wired domain form (status, refresh/disable controls, DNS instructions) backed by server actions.
- CE vs EE: Webpack alias continues to map `@ee/*` to CE stubs, with an enterprise override providing the rich settings panel dynamically.
- Persistence & actions: `portal_domains` table, model helpers, and CE/EE server actions are implemented and committed.
- Temporal scaffolding: Workflow client, DNS verification activity, and reconciliation handle manifest generation; next iteration moves reconciliation to GitOps by rewriting `nm-kube-config` manifests, applying them, and committing the diff.
- Istio & cert-manager: `algapsa-gateway`, `apps-gateway`, and `apps-gateway-auto` continue to terminate traffic with cert-manager issued secrets. Per-tenant `Gateway` + `VirtualService` resources are generated automatically; HTTP-01 challenge routing can be enabled via `PORTAL_DOMAIN_CHALLENGE_*` env configuration.

Target Tenant Experience
1. Admin (EE tenant) opens Settings → Client Portal.
2. Page displays current domain state (none, pending, active, failed) plus canonical target instructions.
3. Admin submits a vanity host (single domain). The backend persists the request, kicks off Temporal, and shows `pending_dns`.
4. Temporal verifies the CNAME points at the canonical target; success transitions to certificate provisioning and reconciliation.
5. Once cert-manager reports Ready and Istio resources are synced, status flips to `active`. Failures surface actionable `status_message` strings.
6. Admin can trigger a refresh or remove the domain; removal re-runs reconciliation to prune Kubernetes resources.
7. CE tenants see only the default portal domain card with no editable controls.

Architecture & Components

Database Schema: `portal_domains`
- Migration via Knex (follow `docs/AI_coding_standards.md`). Lives in CE repo so schema exists everywhere; EE code governs usage.
- Columns:
  - `id` UUID PK
  - `tenant_id` FK → `tenant.tenant_id`
  - `domain` CITEXT unique (vanity hostname requested by tenant)
  - `canonical_host` CITEXT (stored `<tenant7>.portal.algapsa.com`), unique per tenant
  - `status` ENUM: `pending_dns`, `verifying_dns`, `dns_failed`, `pending_certificate`, `certificate_issuing`, `certificate_failed`, `deploying`, `active`, `disabled`
  - `status_message` TEXT (human-friendly guidance)
  - `last_checked_at` timestamptz
  - `verification_method` ENUM default `cname`
  - `verification_details` JSONB (e.g. `{ "expected_cname": "abc1234.portal.algapsa.com" }`)
  - `certificate_secret_name` TEXT (`portal-domain-{tenant_id}`)
  - `last_synced_resource_version` TEXT (for VirtualService/Gateway tracking)
  - Timestamps: `created_at`, `updated_at`
  - Unique constraint `(tenant_id)`

Server Layer (RBAC-aware)
- Actions exposed under `server/src/lib/actions/tenant-actions/portalDomainActions.ts`:
  - `getPortalDomainStatus` (read current row + derived hints). Always safe for CE but returns read-only stub when edition ≠ EE.
  - `requestPortalDomainRegistration(domain)` (validate, ensure Admin RBAC, persist row, enqueue workflow).
  - `refreshPortalDomainStatus()` (poll DB + optionally trigger Temporal query to tighten freshness).
  - `disablePortalDomain()` (mark disabled, signal workflow, enqueue reconciliation).
- REST endpoints (optional) under `/api/settings/client-portal/domain` to support CLI/automation. Wrap each handler with RBAC guard + audit trail entry.
- Edition gating: CE build exports stubs returning the default hosted domain.

Temporal Workflow & Activities
- Workflow: `PortalDomainRegistrationWorkflow` located at `ee/temporal-workflows/src/workflows/portal-domains/registration.workflow.ts`.
- Activities (all in `ee/temporal-workflows/src/activities/portal-domains`):
  1. `recordStatus(domainId, status, message?)` – updates DB row via shared repository helper.
  2. `verifyCname(domain, canonicalHost)` – performs repeated DNS lookups until two consecutive matches (5 min backoff). On timeout → `dns_failed` with guidance.
  3. `renderAndApplyKubernetesState()` – fetches **all** managed rows, renders Istio Gateway/VirtualService and cert-manager `Certificate` manifests, writes optional JSON snapshots to the GitOps worktree (`PORTAL_DOMAIN_MANIFEST_DIR`), applies updates via the Kubernetes API client, records resource versions, and prunes anything no longer present.
  4. `waitForCertificateReady(namespace, certificateName)` – polls cert-manager status via K8s API, emits PostHog metrics (issuance duration) and OpenTelemetry spans, and confirms HTTP-01 challenges are reachable (failing fast with actionable messaging when challenge pods lack ingress).
  5. `waitForIstioSync(domainId)` – checks VirtualService/Gateway `resourceVersion` matches recorded value; updates DB.
  6. `finalizeActivation(domainId)` – optional HTTP probe to `https://domain` to confirm 200 status, then mark `active`.
  7. Shared `handleFailure(domainId, error, stage)` – surfaces sanitized details to `status_message` and emits PostHog failure metric.
- Signals:
  - `removeDomain` – invoked when tenant disables domain to short-circuit and move to tear-down path.
- Observability: Wrap workflow + activities with OpenTelemetry instrumentation (`workflow.logger` + `trace`) and PostHog event names (`portal_domain.dns_verified`, `portal_domain.cert_ready`, etc.).

Kubernetes & TLS Strategy
- Canonical host: Each tenant routes through `<tenant7>.portal.algapsa.com`. This stays backed by the wildcard certificate we already manage (`*.portal.algapsa.com`).
- Vanity host: When the tenant’s vanity domain CNAMEs to the canonical host, cert-manager issues an individual certificate using the HTTP-01 solver. We must ensure Istio routes `/.well-known/acme-challenge/*` to cert-manager’s challenge service; if that path is unavailable we will have the Temporal workflow render the required challenge response assets until issuance completes. Secrets named `portal-domain-{tenant}` live in namespace `msp`.
- Resources:
- `Certificate` per vanity domain (namespace `msp`, `issuerRef` from `PORTAL_DOMAIN_CERT_*` env, default `letsencrypt-dns`) with deterministic secret name `portal-domain-<tenant7>`.
- `Gateway` per domain (namespace `istio-system` by default) exposes HTTP→HTTPS redirect and SNI-bound TLS server using the generated secret.
- `VirtualService` per domain (namespace `msp`) routes vanity traffic to `sebastian.msp.svc.cluster.local:3000`; optional `/.well-known/acme-challenge/*` route forwards to `PORTAL_DOMAIN_CHALLENGE_HOST` when enabled.
- Reconciliation flushes the desired resource set on every run and prunes labelled resources that no longer map to active domains.

GitOps Workflow (nm-kube-config)
- Production manifests live under `~/nm-kube-config/alga-psa/portal-domains/<tenantSlug>.yaml`. Each file contains the rendered `Certificate`, `Gateway`, and `VirtualService` separated by `---` so kubectl/Helm can apply them directly.
- Staging (hv-dev2) mirrors the layout at `~/nm-kube-config/argo-workflow/alga-psa-dev/portal-domains/<tenantSlug>.yaml` to keep dev/test traffic isolated. The workflow picks the target root based on environment.
- `PORTAL_DOMAIN_MANIFEST_DIR` points at the appropriate root folder; on every reconciliation the activity rewrites the per-tenant YAML from database state (sorted keys, deterministic ordering) so Git diffs stay readable.
- After files are updated the activity runs `kubectl apply -f <tenantSlug>.yaml` (or batched apply) against the cluster, stages the changes with `git add portal-domains`, commits with a message like `chore(portal-domains): sync <tenantSlug>`, and pushes to the shared repo.
- A helper CLI (`pnpm nm-kube-sync`) will encapsulate diff detection, safe commit messages, optional PR creation, and fall back to printing `kubectl` commands for manual review when auto-apply is disabled.
- Operational playbook: review the generated Git diff, merge/push (or approve the automation’s push), verify Argo/Flux sync health, then trigger the Temporal refresh action so DB status aligns with the cluster.

UI Updates (CE vs EE)
- CE (`server/src/components/settings/general/ClientPortalSettings.tsx`): Replace “Coming Soon” with a read-only card highlighting default portal address (`<tenant7>.portal.algapsa.com`) and note that custom domains require Enterprise.
- EE (`ee/server/src/components/settings/general/ClientPortalSettings.tsx`):
  - Status banner showing `domain`, `canonical_host`, `status`, `last_checked_at`, and `status_message`.
  - Form with input `id="client-portal-domain-input"`, submit button `id="client-portal-domain-submit"`, and optional `id="client-portal-domain-refresh"` button to poll immediately.
  - DNS instructions card (canonical host, sample CNAME record) and hints for propagation delays.
  - Error panel listing actionable steps (derived from `status_message`).
  - Remove button (`id="client-portal-domain-remove"`) once status is non-pending.
  - Poll status with SWR (15s) while in non-terminal state; respect AI coding standards for naming, instrumentation IDs, and toast usage.

Security & Permissions
- RBAC: Reuse existing tenant admin role checks (`requireTenantPermission('settings.manage_portal')` or similar). Deny actions for non-admins with clear error.
- Audit logging: Insert entries via existing helper for every create, refresh, remove action.
- Validation: Enforce ASCII/LDH host rules, reject apex domains without CNAME capability, normalise to lowercase.

Observability
- Temporal: Use OpenTelemetry tracing already wired in `ee/temporal-workflows` to emit spans for each activity. Tag spans with `tenant_id`, `domain`, `stage` (avoid PII beyond hostnames).
- Metrics: Emit PostHog events (counts, durations, failure reasons). Add dashboards to monitor time-to-activate, failure rate, and number of active domains.
- Logging: Standardise structured logs with correlation IDs (workflow run ID).

Progress Update – 2025-09-19
- ✅ `portal_domains` migration, enums, and model helpers landed with canonical-host storage and normalization utilities.
- ✅ CE/EE server actions implemented with RBAC enforcement, Temporal enqueue hooks, and PostHog capture; CE build returns read-only status.
- ✅ CE UI now surfaces the canonical host; EE UI delivers status badges, form submission, refresh/disable actions, and onboarding guidance.
- ✅ Workflow client + Temporal workflow now render and apply Istio Gateway/VirtualService + Certificate resources via the Kubernetes API, prune stale objects, and capture manifest snapshots when configured.
- ✅ Support documentation added (`ee/docs/guides/portal-domain-runbook.md`) describing operational flows and observability.
- ✅ Optional GitOps export writes JSON manifests for each tenant into `PORTAL_DOMAIN_MANIFEST_DIR`, ready for nm-kube-config commits.
- 🟡 Automated tests remain sparse (initial manifest-render unit test added); workflow + UI coverage still outstanding.

Implementation Plan
1. **Schema & Models** – ✅ Completed (2025-09-19)
   - Migration and model helpers merged; canonical host stored per tenant.
2. **Server Actions & API** – ✅ Completed (2025-09-19)
   - RBAC-guarded EE actions and CE stubs implemented; PostHog instrumentation in place. REST surface still optional (not started).
3. **Temporal Workflow & Activities** – 🟡 In progress
   - DNS verification + reconciliation activities now apply/prune Kubernetes resources and write manifest snapshots; remaining work covers certificate readiness polling, richer status messaging, and workflow tests.
4. **GitOps & Reconciliation Tooling** – 🟡 In progress
   - Per-tenant YAML written to `nm-kube-config/{alga-psa|argo-workflow/alga-psa-dev}/portal-domains`; still need the CLI to diff/commit/apply and docs for the automation flow.
5. **Kubernetes Reconciliation Templates & HTTP-01 Pathing** – 🟡 In progress
   - Gateway/VirtualService templates implemented with optional HTTP-01 routing via `PORTAL_DOMAIN_CHALLENGE_*`; still need to standardise the challenge-serving workload and productionize readiness probes.
6. **UI (CE + EE)** – ✅ Completed (2025-09-19)
   - CE shows default host; EE form with status badges, refresh/disable flows, and guidance shipped. Cypress/Playwright coverage outstanding.
7. **Testing & Verification** – 🔄 Not started
   - Unit/integration tests, workflow harness, and staging checklist to be added.
8. **Rollout** – 🔄 Not started
   - Migration deployment, worker release, and manual onboarding plan remain after backend completion.

Terminal Status UX Matrix
| Status               | UI Treatment                                                                 | Available Actions                               | Next-Step Guidance                                                                 |
|----------------------|-------------------------------------------------------------------------------|-------------------------------------------------|-------------------------------------------------------------------------------------|
| `active`             | Success banner with vanity + canonical host, "Active" badge, last verified time | Refresh, Remove                                 | Inform user domain is live; suggest confirming CNAME remains pointed correctly.     |
| `disabled`           | Neutral banner noting custom domain disabled and default host in use         | Submit new domain, Refresh                      | Explain portal serves canonical host; advise submitting a new domain when ready.    |
| `dns_failed`         | Error banner showing last resolved target + suggested TTL wait               | Refresh, Remove, Retry Registration             | Prompt user to correct DNS record to the canonical host, then retry once propagated.|
| `certificate_failed` | Error banner with cert-manager status message and timestamp                  | Refresh, Remove, Retry Registration             | Direct user to ensure HTTP-01 path is reachable; recommend contacting support if blocked. |


Resolved Questions
- Canonical target storage: store in schema (`canonical_host`).
- DNS / Certificate scope: rely on wildcard `*.portal.algapsa.com` for canonical ingress; vanity domains CNAME into it and are issued certs without extending Route53 zones.
- ACME challenge method: enforce HTTP-01 challenges by exposing `/.well-known/acme-challenge/*` through Istio or temporary challenge-serving workloads managed by the workflow.
- Reconciliation location: handled entirely inside the Temporal activity suite; no separate Kubernetes operator required.
- Resource teardown: reconciliation activity renders the full desired list and prunes anything missing, ensuring deleted domains remove all K8s resources automatically.

Remaining Work & Follow-ups
- Add cert-manager readiness polling + HTTP probes before marking domains `active`; emit PostHog timings + richer status messages for failure cases.
- Finalise HTTP-01 challenge serving (shared solver service or on-demand pod) and bake the required `PORTAL_DOMAIN_CHALLENGE_*` defaults into staging/production.
- Build the GitOps helper CLI (`pnpm nm-kube-sync`) to diff manifests, open PRs, and optionally apply changes; update runbook once available.
- Expand automated coverage: workflow unit/integration tests, CE/EE action tests, and mocked EE UI e2e flows plus a staging validation checklist.
- Validate the new base VirtualService redirect management in staging once rolled out; regression coverage lives in `ee/temporal-workflows/src/activities/__tests__/portal-domain-activities.git.test.ts` to guard the `/client-portal/dashboard` default route.
- Provide operational tooling (Temporal signal CLI/script) for forced reconciliation and document the procedure in the runbook.
- Plan rollout sequencing: migration deployment order, Temporal worker release, customer enablement messaging, and nm-kube-config PR cadence.
