# PRD — Remediating Hosted-Infrastructure Assumptions for the On-Prem Appliance

- **Status:** Decisions locked 2026-06-08 (see §0). Options preserved in §5 for traceability.
- **Date:** 2026-06-08
- **Owner:** Robert Isaacs
- **Scope target:** The Alga PSA **Pro / Essentials on-prem appliance** (`ee/appliance`, single-node k3s ISO).
- **Companion docs:** `SCRATCHPAD.md` (evidence index, file:line), `features.json`, `tests.json`.

---

## 0. Decisions log (locked 2026-06-08, with the user)

| WS | Decision | Notes |
|----|----------|-------|
| **WS1** | **Reuse `packages/email`** — route the Temporal email layer through the shared SMTP provider; delete the throwing `ProductionEmailService` stub | Combined with WS2: resolves the *tenant-configured* SMTP provider, env only as pre-onboarding fallback |
| **WS2** | **Existing Outbound Email screen drives ALL sends** | `Communications > Outbound Email` already writes tenant `providerConfigs`; make the system + Temporal paths resolve that same provider in appliance mode (env fallback). Ship `EMAIL_PROVIDER_TYPE=smtp` default. **No new setup-UI step.** |
| **WS3** | **Add an in-cluster Service for alga-core + set `webhook.url`**; loud-fail the fallback | Fixes inbound IMAP delivery (hostNetwork → reachable endpoint) |
| **WS4** | **Document single-host AND enable multi-host** | Single-host vanity = LB+cert+DNS + `NEXTAUTH_URL` (works today, no code). Multi-host = a small "mark-active" admin path (`upsertPortalDomain status:'active'`) repurposing the existing UI; `PORTAL_DOMAIN_DNS_CHECK=false`. No Istio/cert-manager/GitOps. |
| **WS5** | **Hide the managed-domain (SPF/DKIM) UI** in appliance mode | Resend-only; SMTP relay handles deliverability |
| **WS6a** | **Implement the connected license check-in** | Closes silent-expiry; depends on confirming/standing up the alga-license refresh endpoint contract |
| **WS6b** | **Document online-at-install only** | Offline install bundle is now an **explicit non-goal** |
| **WS7** | **Document egress allowlist + preflight reachability checks** | No registry mirror |
| **WS8** | **Docs only** | Note the appliance-overridden `*.svc.cluster.local` defaults; no startup self-check, no re-pointing defaults |
| **WS9** | **Document inert cloud surfaces + pin tests** they stay fail-closed | No compile-out |

Key reframes from the original draft: WS2 no longer adds a setup-UI step (the screen exists);
WS4 grew from "gate off" to "document + enable multi-host" once we found the portal serves
host-agnostically; WS6b/WS8 shrank to documentation; the offline install bundle was dropped.

---

## 1. Problem statement & user value

We sell a Pro/Essentials appliance that a customer installs **on their own premises**. Parts
of the product were built for Nine Minds' **hosted SaaS** and silently assume Nine Minds-only
infrastructure. When those assumptions don't hold on a customer site, features either fail
loudly (errors), fail silently (no-op), or expose UI for capabilities the appliance can't
deliver. This erodes trust in a product whose entire premise is "runs in your environment."

**User value:** an appliance operator can stand up Pro/Essentials, send and receive email,
run a licensed instance (including renewing it), and never hit a feature that only works in
Nine Minds' cloud. The product behaves as a self-contained on-prem system, with the **one**
unavoidable cloud touchpoint (licensing) made explicit, documented, and — where required —
operable offline.

### 1.1 Critical correction to the initiating analysis

The background analysis was written from the application-code perspective and **over-counts**
the breakage. The appliance ships its **own complete single-node k3s cluster** and runs
Postgres, pgbouncer, Redis, Temporal (frontend + all workers), the email microservice,
local-path storage, and plain Kubernetes Secrets **in-cluster**, overriding every service-DNS
default to the `msp` namespace. Therefore:

- **Already satisfied on the appliance (NOT breakage):** K8s service discovery (#4), Temporal
  (#5), Redis (#7), storage (#8), secrets/Vault (#9). These work because the appliance bundles
  them and overrides the defaults. They are *brittle* (the raw code defaults point at the wrong
  namespace and only work via override) but not *broken*.
- **Dead/inert cloud code (NOT breakage, but surface):** nm-store API key + billing webhooks
  (#2) and Stripe (#2) ship in the image but are never invoked on the appliance; the Stripe
  distribution surface fails closed.
- **By design, in cloud only (NOT on the appliance):** C4 license **signing** (#3) — the
  appliance *receives* a pre-signed JWT and verifies it with a baked-in public key.

The **true** on-prem breakage is the smaller, sharper set in §2.

---

## 2. The real assumptions that break on premise

| ID | Break | Severity | Symptom on a customer site |
|----|-------|----------|----------------------------|
| **B1** | EE Temporal email-service has **no working non-Resend sender** (`sendViaSMTP` is a stub that throws) | **High** | Tenant-onboarding / welcome emails silently no-op (mock) or crash the worker (resend w/o key). No email path works for Temporal-driven mail. |
| **B2** | **Outbound email is OFF by default** and there is **no setup-UI step** to configure it | **High** | A fresh appliance cannot send any email until someone hand-edits Helm values. Operators have no in-product way to enter SMTP creds. |
| **B3** | **Inbound IMAP webhook URL** is unset on the appliance → falls back to `http://server:3000`, which does not resolve in-cluster (alga-core is `hostNetwork`, there is no `server` Service in `msp`) | **High** | Inbound email (IMAP mailboxes) never delivers parsed messages back to the app. Inbound ticketing via IMAP is broken. |
| **B4** | Email provider selection **auto-detects Resend** from key presence; failure messages point at Resend, not SMTP | Medium | Confusing/forced-Resend startup failures; operators get "Resend" errors on a box that should never touch Resend. |
| **B5** | **Managed domain (SPF/DKIM) verification is Resend-only** with no provider abstraction; the UI/action exists | Medium | If exposed, self-service sender-domain onboarding throws "requires RESEND_API_KEY". (Mitigated: it's EE/tier-gated and not required to send.) |
| **B6** | **Portal custom-domain feature** UI is reachable on the appliance, but the backend needs Istio + cert-manager + a `nm-kube-config` GitOps push + `*.portal.algapsa.com` DNS — none of which the appliance has | Medium | Operator configures a custom portal domain; the workflow fails immediately. Dead feature presented as live. |
| **B7** | **Licensing: no implemented renewal.** The connected-appliance daily check-in is provisioned (`check_in_url`, `appliance_credential` stored) but **no runtime code calls it** | **High (latent)** | Paid appliances run until the JWT `exp`, then degrade to Essentials/trial with no automatic renewal. Silent expiry. |
| **B8** | **Licensing: install is online-only.** Adopting the registry tenant-id (`INITIAL_TENANT_ID`) requires reaching `license.nineminds.com/register`; the airgap JWT-paste path covers *licensing* but not *tenant-id adoption* | Medium | A site with no outbound HTTPS to Nine Minds cannot complete install. No documented airgapped-install procedure. |
| **B9** | **Updates/registry require ghcr.io/nine-minds egress.** Release manifests, Flux config, Helm charts, and container images all pull from ghcr at install + update | Medium | Restricted-egress sites can't install or update. No local-mirror path. |
| **B10** | **Brittle service-discovery defaults.** App-code defaults point at `*.temporal.svc.cluster.local` / `*.default.svc.cluster.local`; they only work because the appliance overrides them | Low | No symptom today, but a profile/namespace change, or any non-appliance on-prem deploy, breaks with opaque connection errors. |
| **B11** | **Dead cloud code surface.** nm-store middleware, billing webhook routes, and Stripe distribution code ship in the appliance image | Low | No functional break; unnecessary attack/confusion surface. |

---

## 3. Goals & non-goals

### Goals
1. Outbound email works on the appliance **without Resend**, end-to-end, including Temporal-driven mail (B1, B2, B4).
2. Inbound IMAP email delivers webhooks correctly on the appliance (B3).
3. The appliance never presents UI for cloud-only features it cannot deliver (B5, B6).
4. A licensed (paid) appliance can **renew** without manual JWT re-paste (B7), and there is a **defined airgapped-install** procedure (B8).
5. The cloud touchpoints that remain (licensing redemption, registry/updates) are **explicit, documented, and minimized**, with a path for restricted-egress sites (B9).
6. Service-discovery defaults are hardened so on-prem misconfiguration fails **loudly and clearly**, not silently (B10).
7. Inert cloud code is either compiled out of the appliance build or clearly documented as gated-off (B11).

### Non-goals
- Multi-node / HA appliance (the appliance is single-replica by design; Vault/MinIO remain optional escape hatches, not requirements).
- Replacing Temporal/Redis with a DB-only runtime (bundled and working; out of scope).
- Building a full alternative-ESP integration framework (SendGrid/SES/Mailgun) — SMTP relay is the on-prem email contract; a provider *abstraction* is offered as an option, not a requirement.
- Re-implementing the portal custom-domain *provisioning workflow* against appliance-local ingress (we chose the lightweight "mark-active" path instead — WS4).
- A fully offline/airgapped **install** (offline license bundle) — explicit non-goal (WS6b); install requires a one-time HTTPS reach to `license.nineminds.com`.
- A startup connectivity self-check for service-discovery endpoints (WS8 is docs-only).
- A local registry mirror for airgapped updates (WS7 is document + preflight only).
- Changing the Nine Minds cloud-side issuance/billing (Stripe, C4 `/sign`, nm-store) — those stay in the cloud.

---

## 4. Target users / personas & primary flows

- **Appliance operator (MSP admin):** installs the ISO, enters an install code, configures email, runs the business. Wants a self-contained box.
- **Restricted-egress operator:** same, but the site blocks arbitrary outbound HTTPS. Needs a documented allowlist and (ideally) an offline path.
- **Nine Minds support:** needs the remaining cloud touchpoints to be explicit and debuggable.

**Primary flows touched:** first-boot setup (add email config + license redemption), outbound
email send (system + tenant), inbound IMAP ingestion, license renewal, appliance updates.

---

## 5. Options per workstream (lay out the choices)

Each workstream lists options with trade-offs and a **Recommended** choice. `features.json` /
`tests.json` encode the recommended path; alternatives are preserved here so a decision can be
revisited without losing the analysis.

### WS1 — Make Temporal-driven email send without Resend (B1)
- **Option A (Recommended): Delegate the Temporal email layer to the shared `packages/email` provider.** Replace `createEmailService()`'s dead `ProductionEmailService` path so the worker reuses `SystemEmailProviderFactory` / `SMTPEmailProvider` (already production-ready, nodemailer-based). One email implementation, one config surface.
  - *Pro:* no duplicated nodemailer; SMTP "just works" for welcome/onboarding mail; consistent provider selection. *Con:* requires the temporal-workflows package to depend on/share `packages/email` (verify build boundary; ESM/CJS interop — cf. prior appliance interop fixes).
- **Option B: Implement `sendViaSMTP` directly in `email-service.ts` with its own nodemailer.** *Pro:* no cross-package coupling. *Con:* second copy of SMTP logic to maintain; config drift risk.
- **Option C: Leave Temporal email as mock/no-op on the appliance; route all mail through alga-core.** *Pro:* zero Temporal change. *Con:* welcome/onboarding emails (the main Temporal consumers) silently never send — fails Goal 1.

### WS2 — First-class outbound-email configuration on the appliance (B2, B4)
- **Option A (Recommended): Add an "Email (SMTP)" step to the setup UI** that writes SMTP creds into a Secret + sets `EMAIL_ENABLE=true`, `EMAIL_PROVIDER_TYPE=smtp`. Ship the appliance with `EMAIL_PROVIDER_TYPE=smtp` as the explicit default so Resend is never auto-selected.
  - *Pro:* operators configure email in-product; no Helm hand-editing; removes the auto-detect trap. *Con:* new setup-UI surface + host-service secret wiring.
- **Option B: Document Helm-values editing only.** *Pro:* no UI work. *Con:* poor UX; operators must edit GitOps values and reconcile.
- **Option C: Make email optional but loudly warn** in setup/status when unconfigured. (Complements A or B.)
- **Cross-cutting hardening (do regardless): default `EMAIL_PROVIDER_TYPE=smtp` on the appliance and make the factory's missing-config errors name SMTP, not Resend.**

> **✓ Decision (supersedes the options above):** Don't add a new setup-UI step — the
> `Communications > Outbound Email` screen already exists and writes tenant `providerConfigs`.
> Instead make the **system + Temporal send paths resolve that screen's configured SMTP
> provider** (env fallback only pre-onboarding), and ship `EMAIL_PROVIDER_TYPE=smtp` as the
> appliance default. The screen becomes the single source of truth for all sends.

### WS3 — Inbound IMAP webhook URL on the appliance (B3)
- **Option A (Recommended): Add a stable in-cluster Service for alga-core and set `webhook.url`** in the appliance email-service values to that Service URL (e.g. `http://<alga-core-svc>.msp.svc.cluster.local:3000/api/email/webhooks/imap`). Because alga-core is `hostNetwork`, this needs either a `Service` with matching selector/targetPort or the host node IP.
  - *Pro:* inbound works; explicit, not fallback. *Con:* must verify hostNetwork → Service reachability (may need `hostPort`/node-IP form).
- **Option B: Set `webhook.url` to the host node IP:3000.** *Pro:* simplest. *Con:* node IP may not be stable; needs templating.
- **Option C: Harden the fallback default** in `emailService.ts` to read a single well-known env and fail with a clear message if unset (complements A/B).

### WS4 — Portal custom-domain feature on the appliance (B6)
- **Option A (Recommended): Gate the feature OFF on the appliance** (hide the client-portal domain-settings UI + short-circuit the action) when running in appliance/self-host mode. Single-tenant on-prem doesn't need per-tenant custom portal domains.
  - *Pro:* cheap, correct, no dead UI. *Con:* removes a (currently non-functional) capability; needs a reliable "is appliance" signal.
- **Option B: Re-implement the activities against the appliance's own ingress** (Traefik/k3s + a local issuer) with no GitOps push. *Pro:* feature actually works on-prem. *Con:* large; appliance ships no ingress/cert-manager today; questionable value for single-tenant.
- **Option C: Leave inert, add a clear "not available on this deployment" notice.** *Pro:* minimal. *Con:* still presents a dead-end.

> **✓ Decision (supersedes the options above):** Gate **off the cloud provisioning workflow**,
> but **support vanity domains two ways** — because the portal serves host-agnostically
> (tenant comes from the session JWT; `trustHost: true`; host-scoped cookies; the
> `portal_domains` "active" gate only governs the canonical→vanity cross-origin handoff that
> never triggers when the vanity host *is* canonical):
> 1. **Single-host (no code):** document LB+cert+DNS + set `NEXTAUTH_URL`/`--app-url` to the vanity host. Works on existing code.
> 2. **Multi-host (small add):** a "mark-active" admin action/CLI that calls the existing `upsertPortalDomain` with `status:'active'` for the single tenant; repurpose the existing domain-settings UI to call it instead of the dead workflow; document the LB routing both hosts + `PORTAL_DOMAIN_DNS_CHECK=false`. No Istio/cert-manager/GitOps.

### WS5 — Managed domain (SPF/DKIM) verification (B5)
- **Option A (Recommended): Hide/disable the managed-domain UI on the appliance.** It's Resend-only, EE/tier-gated, and not required to send. Don't expose what can't work.
- **Option B: Introduce an `IDomainProvider` abstraction + a manual-DNS verification provider** (operator adds SPF/DKIM/DMARC records; appliance verifies via local DNS lookup using existing `dnsLookup.ts`). *Pro:* real self-service domain onboarding without Resend. *Con:* non-trivial; only worthwhile if the appliance needs managed sender domains.
- **Option C: Leave as-is** (gated/stubbed; throws if reached). *Con:* dead-end if surfaced.

### WS6 — Licensing lifecycle: renewal + airgap (B7, B8)
- **Renewal (B7):**
  - **Option A (Recommended): Implement the connected check-in.** A scheduled job (or host-service task) that POSTs `appliance_credential` to the stored `check_in_url`, receives a refreshed JWT, and updates `license_state`. Closes the silent-expiry gap; the data plumbing already exists.
  - *Option B:* keep manual re-paste only, but add **expiry warnings** in status/License UI. (Minimum; complements A.)
- **Airgapped install (B8):**
  - **Option A (Recommended): Offline install bundle.** Nine Minds issues a signed bundle (tenant-id + license JWT + metadata) that the operator pastes/uploads at setup; the host-service adopts `INITIAL_TENANT_ID` and seeds `license_state` **without** calling `/register`.
  - *Option B:* document the required HTTPS reach to `license.nineminds.com` and treat online-at-install as the only supported path. (Lower effort; not truly airgapped.)
  - **Default supported path stays online `/register`; offline bundle is the airgap escape hatch.**

> **✓ Decision:** Renewal = **Option A** (implement the connected check-in). Airgapped install
> = **Option B** (document the one-time online `/register` reach; **no offline bundle** — explicit
> non-goal).

### WS7 — Registry/updates for restricted-egress sites (B9)
- **Option A (Recommended baseline): Document the exact egress allowlist** (`license.nineminds.com`, `ghcr.io` + `*.ghcr.io`/pkg-containers) and surface it in setup/preflight.
- **Option B: Support a configurable local registry mirror** for charts/images/release-manifests so airgapped sites can install/update from an internal mirror.
- **Option C: Bake more into the ISO** (pre-pull the large component images). *Con:* ISO bloat (~1.8GB image), staleness.
- **Recommend A now; B as a follow-on for true-airgap customers.**

### WS8 — Harden service-discovery defaults (B10)
- **Option A (Recommended): Add a startup preflight/self-check** that resolves & dials the configured Temporal/Redis/DB endpoints and **fails loudly** with the offending env var + value if unreachable. Keep the appliance overrides as the source of truth.
- **Option B: Re-point the raw code defaults** to a neutral, documented value (or no default → require explicit config). *Pro:* less surprising for non-appliance deploys. *Con:* touches many files; risk of regressions.
- **Option C: Documentation only.** *Con:* doesn't prevent silent failure.

> **✓ Decision:** **Option C (docs only)** — no symptom today; document that the
> `*.svc.cluster.local` defaults are appliance-overridden and must be set for any non-appliance
> deploy. The startup self-check (Option A) is descoped.

### WS9 — Inert cloud-code surface (B11)
- **Option A (Recommended): Document the gated-off surfaces** (nm-store middleware, billing webhooks, Stripe distribution) and confirm each fails closed on the appliance; add tests pinning that they stay inert.
- **Option B: Edition/appliance-gate them out of the build** so the routes don't exist on the appliance. *Pro:* smaller surface. *Con:* build-graph churn; risk of breaking shared imports.
- **Recommend A now (cheap, verifiable); B optional later.**

---

## 6. Data model / integration notes

- **Email config (WS1/WS2):** no new Secret — the existing `Communications > Outbound Email` screen persists per-tenant `providerConfigs` in `tenant_email_settings` (SMTP host/port/user/pass/from). The work is making the **system + Temporal send paths resolve that same provider** in appliance mode (env `EMAIL_*` fallback only pre-onboarding). No schema change.
- **License renewal (WS6a):** reuse the existing `appliance-license-seed` Secret fields (`APPLIANCE_CREDENTIAL`, `CHECK_IN_URL`) and the `license_state` admin-DB row; a successful check-in updates `LICENSE_TOKEN` + `license_state`. No new tables. **Depends on** a confirmed alga-license refresh-endpoint contract (R3).
- **Vanity portal domains (WS4):** the `portal_domains` table already exists; multi-host support inserts/updates a row with `status:'active'` via the existing `upsertPortalDomain` (no workflow). Single-host needs only `NEXTAUTH_URL` = vanity host. `PORTAL_DOMAIN_DNS_CHECK=false` skips the cloud DNS verification.
- **Appliance-mode signal (WS4/WS5/WS9):** identify or introduce a single reliable "running as appliance/self-host" predicate (e.g. presence of `license_state` row / an `APPLIANCE_MODE` env) to gate UI/features consistently.

## 7. UX / UI notes

- **Email:** configured via the existing `Communications > Outbound Email` screen (no new setup-UI step). Appliance status surfaces "Email: configured/unconfigured" based on the resolved provider.
- **License UI:** show license tier, `exp`, and (connected) last-check-in time + a manual "refresh now"; warn before expiry.
- **Client-portal settings:** managed-domain (SPF/DKIM) panel **hidden** on the appliance (WS5). The custom-domain panel is **repurposed** on the appliance to call the mark-active path (WS4) rather than the cloud workflow; single-host vanity needs no UI at all (just `NEXTAUTH_URL`).
- **Preflight/status:** show egress reachability for `license.nineminds.com` and `ghcr.io`.

## 8. Risks, rollout & migration

- **R1 — Temporal/`packages/email` build boundary (WS1-A):** ESM/CJS interop across the package boundary has bitten the appliance before. Mitigation: validate against the real Argo-built image, not just `Dockerfile.build` (cf. prior lesson).
- **R2 — hostNetwork → Service reachability for IMAP webhook (WS3):** verify on a real VM install; node-IP vs Service form.
- **R3 — Renewal endpoint contract (WS6):** the connected check-in needs a confirmed alga-license server contract (request/response shape, auth). If the server side isn't ready, ship expiry-warnings (B-option) first.
- **R4 — Appliance-mode gating regressions (WS4/5/9):** hiding UI must not hide it in cloud; the predicate must be appliance-only.
- **Rollout:** ship behind the nightly channel first, validate on the libvirt VM end-to-end, then promote to stable / pin in `release.json` (per established appliance practice).
- **Migration:** existing installs gain email config via an additive setup step / Helm values; no destructive change. Renewal is additive.

## 9. Acceptance criteria / definition of done

1. On a freshly installed appliance configured only with an SMTP relay (no Resend), **all** send paths — tenant business email, system email, and Temporal-driven welcome/onboarding — send successfully from the one `Outbound Email` screen (B1, B2, B4).
2. Inbound IMAP mailbox messages produce tickets/threads on the appliance (webhook delivered) (B3).
3. The appliance never renders the managed sender-domain UI; the portal custom-domain UI is repurposed so it never enqueues the (dead) cloud workflow. Vanity portal domains work via the documented single-host setup and the multi-host mark-active path (B5, B6).
4. A connected paid appliance refreshes its license automatically before `exp`; install requires a **documented** one-time online reach to `license.nineminds.com` (fully-offline install is out of scope) (B7, B8).
5. The remaining cloud touchpoints (`license.nineminds.com`, `ghcr.io`) are documented with an egress allowlist, surfaced in preflight (B9).
6. Documentation records that the `*.svc.cluster.local` defaults are appliance-overridden and must be set explicitly for any non-appliance deploy (B10).
7. nm-store/Stripe surfaces are verified inert on the appliance and pinned by tests (B11).
8. All changes validated on the real Argo-built appliance image via a VM install, nightly → stable.

## 10. Phasing (suggested)

- **Phase 1 (must-fix functional): WS1, WS2, WS3, WS4, WS5** — all email send/receive paths work from the existing screen; managed-domain UI hidden; vanity portal domains documented (single-host) and enabled (multi-host). This is what makes Pro/Essentials usable on-prem.
- **Phase 2 (licensing durability): WS6a** — implement the connected check-in renewal (gated on the alga-license refresh-endpoint contract). WS6b is documentation.
- **Phase 3 (egress + hygiene docs): WS7, WS8, WS9** — egress allowlist + preflight, brittle-defaults doc, inert-surface inventory + pin tests.

## 11. Testing strategy (80/20)

Light automated set, smoke the rest live (per the team's standing preference). `tests.json`
carries a `kind` field: **19 `automated`** (cheap pure-logic units that silently regress — provider
resolution, startup validation, webhook-URL resolution, the appliance-mode gating predicate,
license JWT verification, and the nm-store/Stripe fail-closed pins) and **33 `smoke`** (anything
needing the full stack, UI, a VM, the real SMTP/IMAP path, host-service iteration, or the
alga-license refresh contract — validated live). The headline live check is the no-Resend VM run
(all send paths + inbound IMAP) followed by a clean Argo-image install, then pin. See
`SCRATCHPAD.md` → "Testing strategy" for the per-test breakdown and the 7 removed (redundant)
tests.
