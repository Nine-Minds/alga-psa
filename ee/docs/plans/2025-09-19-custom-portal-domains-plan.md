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
- Reconciliation: Runs inside a Temporal activity that renders the full desired state on each execution and reapplies Kubernetes resources (no standalone operator).
- Observability: Use our existing OpenTelemetry setup for workflow/activity spans and PostHog for counters and timings.
- Security: Gate all settings actions with RBAC (tenant admins only) and audit via existing logging helpers.

Current State Snapshot
- UI: `server/src/components/settings/general/ClientPortalSettings.tsx` shows a static "Custom Domain (Coming Soon)" card for every edition.
- CE vs EE: Webpack alias maps `@ee/*` to `server/src/empty/*` so CE builds stub features; EE bundles override with real implementations.
- Istio: `algapsa-gateway`, `apps-gateway`, and `apps-gateway-auto` already terminate `algapsa.com` and `*.apps.algapsa.com` with cert-manager-managed secrets.
- Certificates: `ClusterIssuer/letsencrypt-dns` handles ACME issuance; wildcard secrets already exist for `*.apps.algapsa.com`. We will extend usage to `*.portal.algapsa.com` for the canonical host while provisioning vanity-domain certificates via HTTP-01.

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
  3. `renderAndApplyKubernetesState()` – fetches **all** non-disabled rows, renders desired Istio/Certificate manifests, executes `kubectl apply` (or client) to reconcile, and prunes anything no longer present. This is the reconciliation activity (answers “remove and reconcile entire list”).
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
  - `Certificate` per vanity domain (namespace `msp`, `issuerRef` → HTTP-01 capable issuer configuration routed through the portal ingress). Update solver templates to ensure the HTTP-01 solver pod receives traffic for each challenge.
  - `Secret` generated by cert-manager, referenced by Istio TLS Server config.
  - `VirtualService` per tenant binding vanity host + canonical host to the portal service. Dedicated resource avoids conflicting edits.
  - Updates flush entire desired resource set each reconciliation loop; removal ensures stale resources disappear automatically.

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

Implementation Plan
1. **Schema & Models**
   - Write Knex migration for `portal_domains` (CE + EE mirrored if required).
   - Add repository helper in `server/src/models/PortalDomainModel.ts` (and enterprise override if we need extra joins).
2. **Server Actions & API**
   - Implement RBAC-guarded actions and REST handlers; add unit tests covering validation and permission failures.
   - CE stubs return read-only payload referencing canonical host.
3. **Temporal Workflow & Activities**
   - Scaffold workflow, register activities, integrate OpenTelemetry/PostHog instrumentation.
   - Create Vitest unit tests for each activity and workflow integration tests verifying happy-path and failure transitions.
4. **Kubernetes Reconciliation Templates & HTTP-01 Pathing**
   - Define YAML templates under `ee/temporal-workflows/src/k8s/portal-domains`.
   - Implement renderer that consumes full domain list and applies via Kubernetes client. Ensure idempotency and full-list reconciliation for removals.
   - Extend ingress/gateway definitions to reference new secrets and hosts.
   - Ensure `/.well-known/acme-challenge/*` requests route to the cert-manager solver; if ingress cannot expose the solver directly, deploy lightweight challenge-serving workloads as part of reconciliation until issuance completes.
5. **UI (CE + EE)**
   - Update CE component to show static info.
   - Build EE component with form, status polling, error surfacing, and instrumentation IDs.
   - Add end-to-end Cypress/Playwright tests (EE build) covering submission and failure scenarios (mock actions).
6. **Testing & Verification**
   - Add server-side unit tests (actions validation, RBAC).
   - Temporal workflow tests (mock DNS/cert activity durations).
   - Manual checklist in staging: create tenant, submit domain, observe reconciliation, remove domain.
7. **Rollout**
   - Apply migrations.
   - Deploy updated Temporal worker bundle.
   - Validate in dev cluster with a sample domain; monitor OTel traces/PostHog events.
   - Coordinate tenant onboarding manually (no feature flag); update internal playbook once production-ready.

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

