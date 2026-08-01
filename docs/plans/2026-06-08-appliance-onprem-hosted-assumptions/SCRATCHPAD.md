# SCRATCHPAD — On-Prem Hosted-Assumption Remediation

Working memory for the plan. Grounded in a 5-agent codebase sweep on 2026-06-08
(appliance infra, email, licensing/billing, workflow/Temporal/Redis/portal-domain,
storage/secrets). Every claim below has file:line evidence — keep it here so a future
engineer can reconstruct the reasoning without re-doing the sweep.

---

## TL;DR — the background analysis was written from the *app-code* view and over-counts the breakage

The original analysis flagged 9 categories. The decisive fact it missed: **the appliance
ships its own complete single-node k3s cluster and runs everything in-cluster.** That
collapses ~half the list from "broken" to "already solved (just brittle)".

| # | Background concern | Reality on the appliance | Verdict |
|---|---|---|---|
| 1 | Resend (outbound + domain verify) | SMTP path exists in `packages/email`; **EE Temporal email-service has NO working SMTP sender**; outbound email is **OFF by default** on the appliance; managed-domain verify is Resend-only | **REAL BREAK** |
| 2 | nm-store API key + Stripe | Inbound cloud→cloud SaaS surfaces; **inert/dormant on appliance** (never called) | Dead code, no break |
| 3 | C4 license signing | Runs in NM cloud only; appliance **receives** a pre-signed JWT | By design; not on appliance |
| 4 | K8s svc DNS defaults | Appliance overrides every default to `*.msp.svc.cluster.local`; **satisfied** | Brittle, not broken |
| 5 | Temporal required | **Bundled** in-cluster; works; DB-poll fallback exists but unused | Satisfied |
| 6 | Portal-domain workflow K8s-only | Needs Istio + cert-manager + `nm-kube-config` GitOps + `*.portal.algapsa.com`; appliance ships none → **UI exposed, backend dead** | **REAL BREAK (UX)** |
| 7 | Redis required | **Bundled** in-cluster; satisfied | Satisfied |
| 8 | S3/MinIO vs local | Appliance uses `local` on a 50Gi `local-path` PVC at `/data/files`; safe | Satisfied |
| 9 | Vault/secrets multi-replica | `replicaCount: 1` + `env,filesystem` chain; all boot secrets auto-gen in-cluster as env | Satisfied |

So the **true** on-prem breakage is much smaller than the table suggested:
1. **Outbound email** (the real blocker) — Resend coupling in the Temporal layer + off-by-default + no setup-UI path.
2. **Inbound email webhook URL** — appliance leaves it unset → falls back to `http://server:3000` which does NOT resolve in-cluster (alga-core is `hostNetwork`, there is no `server` Service in `msp`).
3. **Portal custom-domain feature** — UI reachable but backend inert on the appliance.
4. **Licensing lifecycle gaps** — online-only at install (no true airgap path for tenant-id adoption) + **connected check-in renewal is provisioned but NOT implemented** (paid appliances silently run until JWT `exp`, then degrade with no auto-renew).
5. **Registry/update egress** — ghcr.io/nine-minds is required at install + update (no airgapped update path).
6. **Latent fragility** — wrong-namespace code defaults; dead cloud code surface.

---

## Evidence index (file:line)

### Appliance bundles its own cluster
- k3s server, traefik+servicelb disabled: `ee/appliance/scripts/bootstrap-control-plane.sh:170`
- k3s binary baked into ISO (`v1.31.6+k3s1`): `ee/appliance/ubuntu-iso/scripts/stage-host-artifacts.sh:143-166`
- Bundled services (msp ns): Postgres `db` StatefulSet, pgbouncer, Redis, Temporal frontend + `temporal-worker` + `workflow-worker`, `email-service` — `ee/appliance/flux/base/platform/appliance-status.yaml:94-103`, `ee/appliance/flux/base/releases/*.yaml`
- Service-name overrides to `msp`: `ee/appliance/flux/profiles/single-node/values/alga-core.single-node.yaml:55-71`, `pgbouncer.single-node.yaml:3-9`, `temporal-worker.single-node.yaml:13`, `email-service.single-node.yaml:17,25`
- App is `hostNetwork` on port 3000 (no ingress, no `server` Service): `alga-core.single-node.yaml:40,44-45`
- Storage = local FS on PVC: `alga-core.single-node.yaml:46-50,82-94`; local-path provisioner `ee/appliance/manifests/local-path-storage.yaml`
- Secrets = plain K8s Secrets, env-injected; `replicaCount: 1`: `alga-core.single-node.yaml:41`; `helm/templates/secret.yaml:124-189`, `helm/templates/postgres/secrets.yaml:23-26`
- Wrong-namespace raw defaults that ONLY work via override: `temporal-frontend.temporal.svc.cluster.local:7233` (e.g. `services/workflow-worker/src/v2/WorkflowRuntimeV2TemporalWorker.ts:8`), `redis.default…`/`pgbouncer.default…` subchart defaults (`ee/helm/email-service/values.yaml:64,72`, `ee/helm/workflow-worker/values.yaml:39,61`)

### Email
- Outbound provider factory auto-detects Resend from key presence: `packages/email/src/system/SystemEmailProviderFactory.ts:28,57-65`; SMTP is the `default` branch `:36-44`; SMTP impl `packages/email/src/providers/SMTPEmailProvider.ts:28` (nodemailer, real dep)
- **EE Temporal email-service stub**: `ee/temporal-workflows/src/services/email-service.ts` — `ResendEmailService` (`:168`, `new Resend()`), `ProductionEmailService.sendViaSMTP` **throws "not implemented"** (`:332-345`); selection `createEmailService()` (`:352-371`); startup throws if `EMAIL_PROVIDER=resend` w/o key (`config/startupValidation.ts:194-195`)
- Consumers that no-op/crash on prem: `sendWelcomeEmail` `ee/temporal-workflows/src/activities/email-activities.ts:534`; tenant-deletion `:1803`
- **Outbound OFF by default**: `helm/values.yaml:306` `email.enabled: false`; appliance `alga-core.single-node.yaml` sets NO email config (confirmed via grep — empty)
- `EMAIL_PROVIDER_TYPE` only emitted if `email.provider` set, else auto-detect: `helm/templates/deployment.yaml:482-487`; helm default `email.provider: ""` (`values.yaml:313`)
- Managed-domain is Resend-only (no `IDomainProvider` abstraction; hard-typed): `packages/integrations/src/email/domains/services/ManagedDomainService.ts:6,141-142,369-401` (throws "requires RESEND_API_KEY" `:386-388`); EE/tier-gated action `ee/server/src/lib/actions/email-actions/managedDomainActions.ts:1-16`; CE-stub `packages/integrations/src/email/domains/oss/entry.ts`
- Domain verification is NOT required to send (SMTP send never consults `email_domains`)
- **Inbound IMAP webhook URL**: default `http://server:3000/api/email/webhooks/imap` `services/email-service/src/emailService.ts:534-546`; appliance `email-service.single-node.yaml` sets no `webhook.url` → env unset → fallback used; helm emits `IMAP_WEBHOOK_URL` only `if .Values.webhook.url` (`ee/helm/email-service/templates/deployment.yaml:187-190`), default `""` (`values.yaml:58`)

### Licensing / billing
- C4 = alga-license (holds private ES256 key): `ee/temporal-workflows/src/activities/appliance-license-activities.ts:6,18-44` (`/sign` needs `ALGA_LICENSE_SERVICE_SECRET`, cloud-only)
- Issuance happens in cloud via Stripe webhook → Temporal: `packages/integrations/src/webhooks/stripe/payments.ts:267-359`; `appliance-license-issuance-workflow.ts:55-110`
- Runtime verify is offline w/ baked public key: `packages/licensing/src/lib/verify-license.ts:44-129`; baked key `license-keys.ts:13-36` (commit `37147df9`)
- Tier/state local: `packages/licensing/src/lib/license-state.ts:54-141`; seat guard `ee/server/src/lib/license/userSeatGuard.ts:16-37`
- Install one-shot to cloud: `ee/appliance/host-service/install-code.mjs:46-105` POSTs to `${ALGA_LICENSE_SERVICE_URL}/register`; URL `ee/appliance/control-plane/manifests/workload.yaml:27` = `https://license.nineminds.com`; adoption `setup-engine.mjs:1016-1070`; `INITIAL_TENANT_ID` adoption `server/scripts/create-tenant.ts:126-127`
- **Connected check-in renewal NOT implemented**: `check_in_url`/`appliance_credential` stored (`install-code.mjs:96-105`, `licenseManagementActions.ts:125-178`) but NO runtime route/job POSTs to it (whole-repo search negative). Airgap paste path exists: `submitLicense` `licenseManagementActions.ts:78-93`
- nm-store inbound SaaS-only, dormant on appliance: `ee/server/src/lib/middleware/withNmStoreApiKey.ts`; `server/src/app/api/billing/{check-tenant,licence-count}/route.ts`
- Stripe distribution fails closed on appliance: `license-state.ts:200-208` (`isLicenseDistributionTenant`)

### Portal domain (cloud-bound, inert on appliance)
- Activities use `kubectl` + Istio Gateway/VirtualService + cert-manager `Certificate` + GitOps push to `nm-kube-config`: `ee/temporal-workflows/src/activities/portal-domain-activities.ts:901-987,1021-1025,1165-1260`; throws w/o `GITHUB_ACCESS_TOKEN`/`PORTAL_DOMAIN_GIT_REPO` (`:904-910`)
- Appliance ships no Istio/cert-manager; `portalDomain.*` values blank, `secretReplicationEnabled:false`: `temporal-worker.single-node.yaml:55-59`
- UI not edition-gated (reachable on appliance): `packages/client-portal/src/domain-settings/{oss,ee}/entry.tsx` both export same component; CNAME target `*.portal.algapsa.com` `server/src/models/PortalDomainModel.ts:80-99`

### Workflow engine knobs
- Temporal authoritative by default; DB-poll substitute exists: `services/workflow-worker/src/index.ts:62-92`; engine choice `ee/packages/workflows/src/lib/workflowRunLauncher.ts:206`; flags `WORKFLOW_RUNTIME_V2_ENABLE_TEMPORAL_POLLING` (default true) / `WORKFLOW_RUNTIME_V2_ENABLE_DB_POLLING` (default false)
- Redis HARD-required for event-stream worker (`shared/workflow/streams/redisStreamClient.ts:141-144` throws) + inbound queue (`shared/services/email/unifiedInboundEmailQueue.ts`) + event bus — bundled, satisfied

### Storage / secrets
- `STORAGE_DEFAULT_PROVIDER` default `local`; base `/data/files` on PVC; S3/MinIO is an escape hatch (EE-gated): `packages/storage/src/config/storage.ts:18-30`, `StorageProviderFactory.ts:44-57`
- Secret chain default Node = read `env,filesystem`, write `filesystem`: `packages/core/src/lib/secrets/secretProvider.ts:161-171`; Vault optional (`:35-46,91-98`); appliance bundles no Vault/MinIO

---

## Decisions LOCKED 2026-06-08 (with the user, one-by-one)

- **Scope = correctness + connectivity-explicitness of the Pro/Essentials appliance**, not multi-node HA, not airgapped install. The appliance IS the on-prem target. Online-at-install is accepted.
- WS1 → **A** reuse `packages/email` (delete the throwing stub).
- WS2 → **existing Outbound Email screen drives ALL sends** (system + Temporal resolve the tenant's SMTP providerConfig, env fallback pre-onboarding; `EMAIL_PROVIDER_TYPE=smtp` default). **No new setup-UI step** — the screen already exists.
- WS3 → **A** add an in-cluster Service for alga-core + set `webhook.url`; loud-fail the fallback.
- WS4 → **document single-host + enable multi-host**: single-host = LB+cert+DNS + `NEXTAUTH_URL`=vanity (works today); multi-host = small mark-active admin path (`upsertPortalDomain status:'active'`) repurposing the existing UI + `PORTAL_DOMAIN_DNS_CHECK=false`. Cloud workflow stays off.
- WS5 → **A** hide the managed-domain (SPF/DKIM) UI on the appliance.
- WS6a → **A** implement the connected check-in renewal (gated on confirming the alga-license refresh endpoint contract, R3).
- WS6b → **document online-only** (NO offline bundle — explicit non-goal).
- WS7 → **A** document egress allowlist + preflight reachability (no mirror).
- WS8 → **C** docs only (no startup self-check, no re-pointing defaults).
- WS9 → **A** document inert surfaces + pin fail-closed tests (no compile-out).

Changing a decision = re-pick in PRD §5, then re-derive that workstream's features/tests.

## New evidence found during decision review (file:line)

- **Existing outbound-email UI** (corrects WS2): `packages/integrations/src/components/email/admin/EmailSettings.tsx` — "Outbound Email" tab, SMTP|Resend selector, host/port/user/pass/from (`:62,135,157,192-256,391-463`); saves via `updateEmailSettings` → tenant `providerConfigs` (`:60-69,104`); read by `EmailProviderManager` for tenant business email. So tenant email is ALREADY SMTP-configurable in-app; the gap is only the system + Temporal paths (env-driven, off by default).
- **Portal serves host-agnostically** (enables WS4 multi-host cheaply): tenant from session JWT not Host (`server/src/app/client-portal/layout.tsx:44-47` "no host header needed!"); `trustHost:true` (`packages/auth/src/nextauth/auth.ts:7`, `edge-auth.ts:26`); cookies host-scoped, no domain pin (`packages/auth/src/lib/session.ts:95-110`); canonical derived from `NEXTAUTH_URL` (`PortalDomainModel.ts:80-100`, `server/src/middleware.ts:52-54`). The `status='active'` gate is ONLY in the canonical→vanity OTT handoff (`api/client-portal/domain-session/route.ts:128-144`, `nextAuthOptions.ts:380-412`) — bypassed when vanity==canonical (`computeVanityRedirect` returns null → same-host redirect `:1944-1949`). Only the Temporal activity sets `status='active'` today (`portal-domain-activities.ts:709`); `upsertPortalDomain`/`updatePortalDomain` exist to do it without the workflow (`PortalDomainModel.ts:169-270`). DNS check skippable via `PORTAL_DOMAIN_DNS_CHECK=false` (`domain-session/route.ts:71-84`).

## Testing strategy (80/20 — light automated, smoke the rest)

Per Robert's standing preference ([[test-plan-light-auto-smoke-rest]], [[no-unit-tests-for-appliance-status]]): automate only **cheap pure-logic tests that silently regress and are hard to catch live**; validate everything else **live**. `tests.json` carries a `kind` field per test.

- **Automated (19):** provider resolution + factory (T001-T005, T013), startup validation (T008-T009), SMTP error-message hardening (T015), webhook-URL resolution (T020-T021), mark-active no-enqueue (T026), appliance-mode gating predicate + cloud-leak regression (T030, T033, T034), license JWT verification against the baked key (T039-T040), fail-closed pins (T052 nm-store, T054 Stripe distribution). All unit-level, no stack.
- **Smoke (33):** anything needing the full stack, UI, a VM, the real SMTP/IMAP path, helm-render/live env, host-service iteration (license check-in tasks T036/T037/T042/T044 live, not unit — per the appliance-status memory), the alga-license refresh contract (T038), and the headline end-to-end VM runs (T055-T059).
- **Removed (7, redundant/tautological):** T025/T047/T048/T051 (pure doc-existence checks — the feature IS writing the doc); T029 (no-portal-run, covered by T027+T030); T035 (same-predicate, covered by T034); T053 (app-works-without-webhooks, covered by T055). IDs left as gaps for stable referencing.

The headline confidence-giver is **T055** (fresh appliance + SMTP only: all send paths + inbound IMAP, no Resend) plus **T057/T058** (clean VM install on the Argo image, then pin). If those pass live, the automated unit set covers the silent-regression risk underneath.

## Resolved questions
- Inbound/managed email scope → outbound SMTP is the must-have; inbound IMAP fixed (WS3); managed-domain hidden (WS5).
- Airgapped install → out of scope; online-at-install documented (WS6b).
- Airgapped updates / mirror → out of scope; egress documented + preflight (WS7).

## Implementation surprises / discoveries (append as we build)

- **2026-06-09 — F024 already exists.** Don't build an appliance-mode predicate. Reuse **`isSelfHostLicensing()`** (`packages/licensing/src/lib/license-state.ts:208`, async; true ⇔ a `license_state` row exists ⇔ self-host appliance, false ⇔ Nine Minds cloud). Already exported as `isSelfHostLicensingAction()` (`packages/licensing/src/actions/license-actions.ts:118`) and used for gating (`server/src/app/msp/layout.tsx:62`, `.../licenses/page.tsx:31`). Plain edition checks (`NEXT_PUBLIC_EDITION==='enterprise'`) do NOT separate appliance from cloud (both are EE) — `isSelfHostLicensing()` is the correct signal. WS4/WS5 gating keys off this.
- **2026-06-09 — Server-side email already screen-driven.** `TenantEmailService.getEmailProvider()` (`packages/email/src/TenantEmailService.ts:182-241`) already: tenant `provider_configs` first → `SystemEmailProviderFactory` (env) fallback only when none enabled (gated `isEnterprise`; appliance is EE). `SystemEmailService` (system mail) is env-only by design = correct pre-onboarding fallback. **So WS2 server side needs little/no change.** The whole WS1/WS2 gap is the **EE Temporal worker** (`ee/temporal-workflows/src/services/email-service.ts`): `ProductionEmailService.sendViaSMTP` throws (`:342-345`); the `export const emailService = createEmailService()` singleton (`:390`) has no tenant context.
- **2026-06-09 — Worker email plan (locked seam).** `tenant_email_settings` has **no RLS** and the SMTP password is stored **plaintext inline** in `provider_configs[i].config.password` (write: `packages/integrations/src/actions/email-actions/emailSettingsActions.ts:142`). The worker already depends on `@alga-psa/db`/`@alga-psa/core` and both send sites (`email-activities.ts:522 sendWelcomeEmail`, `tenant-deletion-activities.ts:1820`) already carry `tenantId`. Seam = a dependency-light shared resolver `loadTenantEmailSettings(tenantId, knex)` + `pickEnabledProvider()` (mirror `TenantEmailService.ts:258-277` query + `:399-429` parse), and implement the worker SMTP send via `nodemailer` or the isolated `SMTPEmailProvider` (only deps: nodemailer + core/types — safe to import alone). Do NOT import all of `@alga-psa/email` into the worker (drags in Redis rate-limiter / delayed-queue / Next-server assumptions). Replace `await emailService` with `await getEmailServiceForTenant(tenantId)`; worker resolves From from the enabled config's `from`/`default_from_domain`, env `EMAIL_FROM` fallback. Build the temporal-worker under nvm Node 22 ([[snap-node-breaks-esbuild-builds]]).

## Commands / runbook
- Re-run the grounding sweep: 5 parallel agents over `ee/appliance/`, `packages/email`, `packages/integrations/src/email/domains`, `ee/temporal-workflows`, `packages/licensing`, `services/workflow-worker`, `packages/storage`, `packages/core/src/lib/secrets`.
- Appliance build/test loop: see memory `[[appliance-image-build-argo]]`, `[[appliance-teardown-ui-reinstall]]`, `[[appliance-vm-virsh-iso-test]]`, `[[appliance-install-code-e2e-validated]]`.
