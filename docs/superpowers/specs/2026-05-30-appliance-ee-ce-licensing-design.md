# Appliance Unified EE/CE ISO + Offline Licensing — Design Spec

**Date:** 2026-05-30
**Status:** Approved design, pending implementation plan
**Scope:** One spec, three sequenced components (license contract → app runtime → appliance integration)

---

## 1. Goal

Ship a single all-in-one appliance ISO. At setup the operator chooses **Enterprise**
(a 30-day free trial) or **Community** functionality. After the trial — or whenever a paid
license lapses — the install drops to a **Community-equivalent** feature set. Operators can
enter a signed license at any time to unlock Enterprise functionality through the license's
expiry (sold monthly or annually).

The appliance always deploys the **Enterprise build** (it physically contains EE code). The
"Community-equivalent" experience is produced at runtime via the tier system, **not** by
deploying the separate open-source CE build. The open-source CE build remains a distinct,
license-clear artifact for parties who want no EE code at all; this project does not change it.

## 2. Background (current architecture, condensed)

Two orthogonal feature-gating axes exist today:

- **Edition** (`EDITION` / `NEXT_PUBLIC_EDITION`) — a **build-time** choice. `next.config.mjs`
  aliases `@enterprise/*`, `@ee/*`, `@alga-psa/ee-stubs/*` to either real EE source or CE
  stubs. `NEXT_PUBLIC_EDITION` is **statically inlined into the client bundle** at build time
  (read directly by many client components, e.g. `packages/clients/src/components/clients/ClientDetails.tsx`,
  `packages/email/src/features.ts`), and the appliance image bakes it to `enterprise`
  (`ee/server/Dockerfile.build`). It therefore **cannot be flipped at runtime** to change
  client behavior.
- **Tier** (`tenants.plan`, runtime) — `solo` / `pro` / `premium`, resolved **per-request**.
  `server/src/lib/tier-gating/assertTierAccess.ts` short-circuits to "no restrictions" when
  `!isEnterprise`. Existing premium/solo→pro trials are resolved per-request from
  `stripe_subscriptions` metadata — the pattern this design mirrors.

Consequences that shape the design:

1. The tier system alone cannot express "Community functionality" — it lives entirely *inside*
   Enterprise, and even `solo` unlocks most features. A new tier is required.
2. `EDITION` is the build-time, open-source switch and stays exactly that. It cannot carry a
   runtime on/off (client-inlined, evaluated once at process start) and cannot distinguish
   self-hosted-EE from SaaS-EE (both build as `enterprise`).
3. The EE build already contains the CE fallback paths (`FeaturePlaceholder`, 404 routes);
   they are merely selected at build time today. Making that selection *runtime* lets the new
   floor tier reuse them.

## 3. Key decisions

- **CE build untouched** — remains the genuinely open-source artifact.
- **Appliance always deploys the EE image.** A new **`essentials`** tier, ranked **below
  `solo`**, is the Community-equivalent experience on that image.
- **Offline signed license** — a compact signed JWT (ES256 / ECDSA P-256). Public key baked
  into the EE build; private key held only by an internal signing CLI. Verified with no
  network call.
- **License encodes a tier** — `{ tier, exp, ... }`, so Pro vs Premium is sellable later.
- **License/trial state is app-owned in the admin DB**, effective tier resolved **per-request**
  (mirrors the premium-trial resolver — expiry needs no cron, no restart).
- **Self-host licensing mode is data-driven** — the appliance writes one install-level
  `license_state` record; its presence selects offline-license resolution. **No new env var.**
  SaaS installs have no such record and are completely unaffected.
- **The floor tier reuses the existing CE fallbacks** via a runtime
  `eeRuntimeEnabled = isEnterprise && rank(effectiveTier) > rank('essentials')` check applied
  at the EE surface choke points.
- **Issuance scope** — the signed license format, app/appliance verification + gating +
  in-app management UI, and a minimal internal signing CLI. A self-service portal / Stripe
  auto-issuance is a separate future project.

## 4. Architecture overview

### 4.1 The two axes, after this change

- **Edition** — unchanged, build-time, open-source switch.
- **Tier** — runtime, per-request, gains a new lowest level **`essentials`**.
  `TIER_RANK`: `essentials` (lowest) < `solo` < `pro` < `premium`.

### 4.2 Self-host licensing mode (data-driven)

A single install-level **`license_state`** row in the admin DB. Its **presence** means
"resolve tier from offline licensing." Absence (every SaaS tenant) preserves today's
resolution exactly (`NULL → pro`, Stripe trials).

### 4.3 License / trial state machine (install-wide)

| State | How entered | Effective tier (all tenants) |
|---|---|---|
| `ce` | Chose "Community" at setup | `essentials` |
| `trial` | Chose "Enterprise" at setup, or "Start trial" later | `premium` until `trial_started_at + 30d` |
| `trial_expired` | 30 days elapse with no license | `essentials` |
| `licensed` | Valid signed license entered | `license.tier` until `license.exp` |
| `license_expired` | License `exp` passes, no renewal | `essentials` |

### 4.4 Effective-tier resolution (self-host mode), per request

```
1. license present AND verify(license) ok AND now < license.exp   → license.tier
2. else trial_started_at set AND now < trial_started_at + 30d      → premium  (trial tier)
3. else                                                            → essentials
```

In self-host mode this **supersedes `tenants.plan`** (the appliance never sets it
meaningfully), giving a single source of truth. Verification results are memoized in-process
keyed by the token string. Renewals/upgrades take effect on the next request.

## 5. Component 1 — License token contract & signing CLI

**Format:** compact signed JWT (JWS), **ES256 (ECDSA P-256)** — compact signatures keep the
pasted license short. The JWT header carries a **`kid`** selecting which baked-in public key
verifies it, enabling key rotation without breaking deployed appliances.

**Claims:**

```jsonc
{
  "iss": "nineminds-license",
  "sub": "<license-id>",        // unique id, for support/lookup
  "cust": "<customer name/id>", // human-readable, shown in the UI
  "tier": "pro" | "premium",    // entitled tier (essentials/solo are never sold)
  "seats": 50,                  // optional; informational in v1 (not enforced)
  "iat": 1717000000,
  "exp": 1748536000             // monthly/annual boundary
}
```

**Artifacts:**

1. **Verification, added to the existing `packages/licensing` package** (which already holds
   seat-licensing):
   - `verifyLicense(token): { valid, claims, reason }` — verifies the signature against the
     baked-in P-256 public key(s) keyed by `kid`, validates `exp`/`iat`.
   - Public key(s) ship as a checked-in constant/PEM — no secret material in the build.
2. **Signing CLI** (`ee/`, internal-only, holds the **private key**):
   - `alga-license sign --customer "Acme" --tier premium --months 12 [--seats 50]` → a signed
     token. The private key is supplied at runtime (env/file), never committed. Doubles as the
     test-fixture generator (throwaway keypair).
3. **Key-management doc** — private-key custody, `kid` rotation, manual issue/renew procedure.

Because verification is a pure function of `(token, public key)`, every downstream component is
testable end-to-end with CLI-minted tokens — valid, expired, wrong-key, tampered — offline.

## 6. Component 2 — App runtime licensing & edition gating

### 6.1 DB schema (admin DB) — singleton `license_state`

```
license_state (singleton)
  edition_choice    text         -- 'ce' | 'ee'
  trial_started_at  timestamptz  -- null until a trial begins
  license_token     text         -- null until a key is entered
  updated_at        timestamptz
```

Tier is derived per-request, never materialized into `tenants.plan`. Per-tenant licensing is a
future extension; SaaS already does per-tenant via Stripe.

### 6.2 Effective-tier resolver

`resolveSelfHostTier()` reads the singleton and returns `{ tier, state, expiresAt }`, or `null`
when no record exists. The server resolver (`assertTierAccess.ts:getTenantTier`) and the
next-auth session callback consult it **first**; `null` falls through to today's Stripe/`plan`
logic unchanged. The session gains `effectiveTier` and an `eeEnabled` boolean so the client can
gate without reading `NEXT_PUBLIC_EDITION`.

### 6.3 `eeRuntimeEnabled` + choke-point conversion (the main effort)

New helper: server `eeRuntimeEnabled() = isEnterprise && rank(effectiveTier) > rank('essentials')`;
client reads `eeEnabled` from `TierContext`.

The first task of this component is a **classified inventory** of every `isEnterprise` /
`NEXT_PUBLIC_EDITION === 'enterprise'` check:

- **Module-presence guards** (deciding whether to `import()` an `@enterprise`/`@ee` module that
  is compiled out of CE) → **left as build-time `isEnterprise`.** On an EE build the module
  exists at `essentials`; converting these would break imports.
- **Surface/feature-exposure gates** (deciding whether a user sees an EE page/route/component/
  affordance) → **converted to `eeRuntimeEnabled` / `eeEnabled`,** so `essentials` falls through
  to the existing CE placeholder/404 paths.

When a checkpoint is ambiguous, it is **locked at `essentials`** (the safe default) and refined.

### 6.4 In-app License page (the one intentional exception)

A new admin page (a "License" area under settings) showing current state + expiry, with:
paste-a-license (verified on submit via `packages/licensing`, stored in `license_state`) and
"Start 30-day Enterprise trial." **Gated by admin RBAC only — not by `eeRuntimeEnabled`** —
so an expired install can always renew. Server actions: `getLicenseStatus()`,
`submitLicense(token)`, `startTrial()` (guarded to one trial per install; available to a
CE-chosen install that later wants to try Enterprise).

### 6.5 Seat claim

The `seats` claim is informational in v1; it is deliberately not wired to the existing
`licensed_user_count` enforcement (future enhancement).

## 7. Component 3 — Appliance integration

1. **Setup UI** (`ee/appliance/status-ui/app/setup/page.tsx`) gains an **edition choice**
   ("Enterprise — 30-day free trial, then reverts to Essentials" vs "Essentials") and an
   **optional license-key field**. Both flow into the existing `/api/setup` POST.
2. **Control-plane `server.mjs`** accepts `editionChoice` ('ee'|'ce') and optional `licenseKey`,
   does a light well-formed-JWS format check (authoritative verification stays in the app), and
   persists them with the other setup inputs. The control-plane image carries no public key,
   keeping coupling low.
3. **Seeding into the app.** `setup-engine.mjs` writes an `appliance-license-seed` secret
   (`EDITION_CHOICE`, `LICENSE_TOKEN`). A new migration creates `license_state`; the sebastian
   **bootstrap job** (small chart change to wire the seed secret into its env) upserts the
   singleton at first boot:
   - `ce` → `edition_choice='ce'`, no trial → essentials.
   - `ee`, no key → `trial_started_at = now` → 30-day premium trial.
   - key provided → store token (verified by the app) → licensed.

   `EDITION` / `NEXT_PUBLIC_EDITION` stay `enterprise`; no Helm edition change.
4. **Trial/expiry surfacing.** Primary surface is the **in-app banner**, reading
   `getLicenseStatus()`. Showing trial state in the **control-plane status UI** is a v1 stretch
   goal — it would require the app to expose a small status endpoint the control-plane can poll,
   since `license_state` lives in the app's admin DB.

## 8. Security model

- **Integrity rests on the signature and expiry.** A license is a JWT signed with a private key
  held only by Nine Minds; the appliance verifies it against a baked-in public key and honors
  the embedded expiry. Monthly/annual terms bound each license's lifetime.
- **Key rotation** is supported via `kid`-selected public keys.
- **Revocation is expiry-based in v1.** Online revocation (the previously-considered hybrid
  model) is a possible future enhancement.
- **Licenses are not install-bound in v1**; install-fingerprint binding is a possible future
  enhancement. `cust`/`sub` are embedded for traceability and support.

## 9. Testing strategy

- **Unit:** `verifyLicense` (valid / expired / wrong-`kid` / tampered) against a throwaway
  keypair; `resolveSelfHostTier` state transitions; `eeRuntimeEnabled` rank logic.
- **Integration:** seed `license_state`; assert effective tier + `eeEnabled` across all five
  states; assert the **SaaS path (no record) is unchanged**.
- **Choke-point:** for converted surfaces, `essentials` → placeholder/404; `pro`/`premium` →
  real surface.
- **Appliance:** validated **live on the VM**, not unit-tested, consistent with the team's
  standing approach for iterative appliance host-service work.

## 10. Out of scope (v1)

Self-service purchase/renewal portal and Stripe auto-issuance; online revocation; install/
hardware binding; seat enforcement from the license; per-tenant licenses on the appliance;
OS/k3s update changes.

## 11. Defaults

- Trial tier: **premium**.
- Initial license entry at setup: **supported** (optional).
- Control-plane trial display: **optional / stretch** (in-app banner is the primary surface).

## 12. Implementation sequencing

1. **Component 1** — token contract, verification in `packages/licensing`, signing CLI,
   test fixtures.
2. **Component 2** — `essentials` tier; `license_state` schema; `resolveSelfHostTier`; session
   `effectiveTier`/`eeEnabled`; choke-point inventory + conversion; in-app License page.
3. **Component 3** — setup UI choice + license field; control-plane plumbing; bootstrap seed +
   chart wiring; in-app trial banner.

Components 1→2→3 are dependency-ordered; Component 2 is independently testable on any EE deploy
by writing a `license_state` row and observing tier/edition behavior change.
