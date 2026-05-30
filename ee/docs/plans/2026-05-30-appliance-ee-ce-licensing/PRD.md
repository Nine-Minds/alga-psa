# PRD — Appliance Unified EE/CE ISO + Offline Licensing

**Date:** 2026-05-30
**Design spec:** `docs/superpowers/specs/2026-05-30-appliance-ee-ce-licensing-design.md` (commit b749bf2b5)
**Plan folder:** `ee/docs/plans/2026-05-30-appliance-ee-ce-licensing/`

## 1. Problem statement & user value

Today the appliance installs only the Enterprise build with no licensing controls. We want one
all-in-one ISO whose operator chooses, at setup, **Enterprise** (a 30-day free trial) or
**Community** functionality. After the trial — or when a paid license lapses — the install drops
to a Community-equivalent feature set. Operators can enter a signed license at any time to unlock
Enterprise functionality through the license's expiry (sold monthly or annually).

The appliance always deploys the **Enterprise build** (it physically contains EE code). The
Community-equivalent experience is produced at **runtime** via the tier system, not by deploying
the separate open-source CE build. The OSS CE build remains a distinct, license-clear artifact and
is **out of scope/unchanged**.

User value: a single download; try Enterprise free for 30 days; pay to keep it; otherwise keep
using a stable Community-equivalent feature set — all offline, with no forced data loss.

## 2. Goals

- Single ISO; setup-time **Enterprise (trial) vs Community** choice.
- A new **`essentials`** tier (ranked below `solo`) = the Community-equivalent runtime on the EE build.
- **Offline signed licenses** (ES256 JWT) verified against a baked-in public key; entered in a UI; expiry-bounded.
- **30-day Enterprise trial**, then automatic drop to `essentials`.
- **Per-request** effective-tier resolution (no cron, no restart) — renewals/upgrades take effect immediately.
- **Exhaustive parity**: at `essentials`, every EE surface is hidden surface-for-surface like CE.
- **SaaS/hosted resolution is unchanged.**

## 3. Non-goals (v1)

- Self-service purchase/renewal portal or Stripe auto-issuance (issuance = internal signing CLI only).
- Online license revocation / phone-home.
- Install/hardware binding of licenses.
- Seat enforcement driven by the license (`seats` claim is informational).
- Per-tenant licenses on the appliance (license is install-wide).
- Control-plane status-UI trial/license display (deferred; in-app banner is the v1 surface).
- OS/k3s update changes; any change to the open-source CE build or the `EDITION` build switch.

## 4. Target users & primary flows

**Persona:** the on-prem operator/admin installing and running the appliance.

1. **Choose at setup.** Operator picks Enterprise (trial) or Community in the appliance setup UI;
   optionally pastes a license they already bought. The choice seeds the install's license state.
2. **Trial countdown.** An Enterprise-trial install shows full Enterprise features and an in-app
   banner counting down the 30 days.
3. **Enter/renew a license.** From an always-reachable in-app License page, an admin pastes a
   signed key; the app verifies it offline and unlocks the encoded tier through the key's expiry.
4. **Lapse.** When the trial or license expires, effective tier drops to `essentials` and EE
   surfaces hide (CE-equivalent), with the License page still reachable to renew.
5. **Start a trial later.** A Community-chosen install can start the one-time 30-day trial from the
   License page.

## 5. Architecture summary (see design spec for detail)

- **Edition** stays a build-time switch (`EDITION`/`NEXT_PUBLIC_EDITION`), unchanged.
- **Tier** gains `essentials` below `solo`.
- **Self-host licensing mode is data-driven**: one install-level `license_state` row (admin DB);
  its presence selects offline-license resolution. SaaS installs have no row → existing logic.
- **Effective-tier resolution (self-host), per request:** valid license → `license.tier`;
  else active trial → `premium`; else `essentials`.
- **Runtime edition behavior:** `eeRuntimeEnabled = isEnterprise && rank(effectiveTier) > rank('essentials')`,
  surfaced to the client via `TierContext.eeEnabled`; surface choke points route `essentials`
  through existing CE placeholders/404s.

## 6. Requirements / Functional Requirements

### Component 1 — License token contract & signing

- **FR1 — License token format.** Compact signed JWT, ES256 (ECDSA P-256), header `kid`; claims
  `iss, sub, cust, tier∈{pro,premium}, seats?, iat, exp`.
- **FR2 — Verification module.** `verifyLicense(token)` in `packages/licensing` returns
  `{ valid, claims, reason }`; checks signature against baked-in public key(s) selected by `kid`,
  validates `iat`/`exp`; pure function (no network).
- **FR3 — Public keys & rotation.** Public key(s) ship as a checked-in constant/PEM keyed by `kid`;
  multiple keys supported for rotation; no secret material in the build.
- **FR4 — Signing CLI & key custody.** Internal `alga-license sign --customer --tier --months [--seats]`
  CLI (private key supplied at runtime, never committed); key-management/rotation doc; generates
  test fixtures (valid/expired/wrong-kid/tampered) from a throwaway keypair.

### Component 2 — App runtime licensing & edition gating

- **FR5 — `essentials` tier.** Add `essentials` to `TENANT_TIERS`/`TIER_RANK` (lowest) in
  `packages/types`; ensure feature minimums and `resolveTier` handle it; never sold (not a license tier).
- **FR6 — `license_state` schema.** Admin-DB singleton (`server/migrations`): `edition_choice`,
  `trial_started_at`, `license_token`, `updated_at`.
- **FR7 — Self-host mode detection.** `resolveSelfHostTier()` returns `{ tier, state, expiresAt }`
  when a `license_state` row exists, else `null` (→ existing SaaS path); verification memoized by token.
- **FR8 — Effective-tier resolution.** Order: valid license → `license.tier`; else active 30-day
  trial → `premium`; else `essentials`. In self-host mode this supersedes `tenants.plan`. SaaS path
  (no row) is byte-for-byte unchanged (`NULL → pro`, Stripe trials).
- **FR9 — Session plumbing.** Add `effectiveTier` + `eeEnabled` to the next-auth session/JWT so the
  client gates without `NEXT_PUBLIC_EDITION`.
- **FR10 — Runtime gating helpers.** Server `eeRuntimeEnabled()`; client `TierContext.eeEnabled`.
- **FR11 — Choke-point inventory (exhaustive).** Produce a classified inventory of every runtime
  `isEnterprise` / `NEXT_PUBLIC_EDITION` / `process.env.EDITION` usage: **module-presence guard**
  (leave build-time) vs **surface/feature-exposure gate** (convert).
- **FR12 — Exhaustive surface conversion + default-locked safety.** Convert every surface-exposure
  gate to `eeRuntimeEnabled`/`eeEnabled` so `essentials` matches CE surface-for-surface; add a
  default-locked safety so unconverted/ambiguous surfaces stay hidden at `essentials`.
- **FR13 — In-app License page.** Admin page under the EE `msp/licenses` area showing state + expiry;
  paste-a-license and "Start 30-day Enterprise trial." **Gated by admin RBAC only — not by
  `eeRuntimeEnabled`** — so an expired install can renew.
- **FR14 — Trial/expiry banner.** In-app banner showing trial days remaining / license state / expiry.
- **FR15 — License/trial server actions.** `getLicenseStatus()`, `submitLicense(token)` (verify+store),
  `startTrial()` (guarded to one trial per install; available to a Community-chosen install).

### Component 3 — Appliance integration

- **FR16 — Setup UI.** `status-ui/app/setup/page.tsx` gains an Enterprise-trial vs Community choice
  and an optional license-key field, with client validation; both added to the `/api/setup` payload.
- **FR17 — Control-plane intake.** `server.mjs` `/api/setup` accepts `editionChoice∈{ee,ce}` and
  optional `licenseKey` (light well-formed-JWS check only; app verifies authoritatively); persists to
  setup inputs.
- **FR18 — Seed secret.** `setup-engine.mjs` writes an `appliance-license-seed` Secret
  (`EDITION_CHOICE`, `LICENSE_TOKEN`).
- **FR19 — Bootstrap seeding.** The sebastian **bootstrap job** (chart wiring of the seed Secret →
  env) upserts the `license_state` singleton at first boot: `ce`→essentials; `ee` w/o key→trial
  (`trial_started_at=now`); key→licensed.
- **FR20 — No edition regression.** `EDITION`/`NEXT_PUBLIC_EDITION` remain `enterprise`; no Helm
  edition change; appliance still deploys the EE image.

## 7. Data model / API notes

- **`license_state`** (admin DB, singleton): `edition_choice text`, `trial_started_at timestamptz null`,
  `license_token text null`, `updated_at timestamptz`. Tier derived per-request, never written to `tenants.plan`.
- **Server actions** (EE app): `getLicenseStatus`, `submitLicense`, `startTrial`.
- **Setup payload additions:** `editionChoice`, `licenseKey?`.
- **K8s:** `appliance-license-seed` Secret (`EDITION_CHOICE`, `LICENSE_TOKEN`) in `msp`.

## 8. Risks, rollout & open questions

- **Exhaustive-parity completeness** (an EE surface leaking at `essentials`): mitigated by the
  classified inventory (FR11), default-locked safety (FR12), and per-area essentials-parity tests.
- **Client `NEXT_PUBLIC_EDITION` reads are build-inlined to `enterprise`** on the appliance image;
  all client surface gating must route through `TierContext.eeEnabled`.
- **Session staleness:** server `assertTierAccess` re-resolves per request (authoritative); client UI
  may lag until session refresh/poll — acceptable.
- **SaaS regression** is the top guardrail — explicit tests assert the no-row path is unchanged.
- **Open:** confirm how the sebastian bootstrap executes admin-DB migrations on the appliance (tracked in SCRATCHPAD).

## 8.1 Testing approach

Keep automated tests light — a **core set for ~80% confidence on the pure logic**: license
verification (FR1–FR4), effective-tier resolution + gating helpers (FR7–FR10), license/trial server
actions (FR15), and the **SaaS-regression guardrail** (FR8). Broader coverage — UI surfaces (License
page, banner), the **exhaustive per-area `essentials` parity** checks, and the appliance
setup/bootstrap flow — is documented in `tests.json` as **smoke tests** (`testType: "smoke"`) to be
run/validated later (appliance pieces live on the VM), rather than automated upfront.

## 9. Security model

Integrity rests on the **signature** (private key held only by Nine Minds) and the embedded **expiry**;
`kid` enables key rotation. Revocation is expiry-based in v1; online revocation and install-binding are
possible future enhancements. (Stated neutrally per public-doc policy.)

## 10. Acceptance criteria / definition of done

1. Setup offers Enterprise-trial vs Community; choice + optional license seed the install state.
2. An Enterprise-trial install shows full Enterprise features and a countdown; at day 30 it drops to `essentials`.
3. Pasting a valid signed license unlocks the encoded tier through its expiry; an expired/invalid key does not.
4. At `essentials`, EE surfaces are hidden surface-for-surface like CE; the License page stays reachable.
5. A Community-chosen install can start the one-time trial later from the License page.
6. SaaS/hosted tier resolution is provably unchanged (tests).
7. `EDITION` build switch and the OSS CE build are untouched.
8. License verification works fully offline; the signing CLI issues valid keys.
