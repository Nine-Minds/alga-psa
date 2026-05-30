# SCRATCHPAD — Appliance Unified EE/CE ISO + Offline Licensing

Design spec (approved): `docs/superpowers/specs/2026-05-30-appliance-ee-ce-licensing-design.md` (commit b749bf2b5)

## Conventions discovered (repo)
- Plans live under `ee/docs/plans/<YYYY-MM-DD-slug>/`. This plan: `ee/docs/plans/2026-05-30-appliance-ee-ce-licensing/`.
- `features.json`: `{ id: "F001", description, implemented: bool, prdRefs: [] }`.
- `tests.json`: `{ id: "T001", description, implemented: bool, featureIds: [] }` (usually 1–3 per feature).
- Tests: **vitest** (`server` test script = `vitest`). Contract tests use `*.contract.test.tsx`.
- Admin DB uses `DB_USER_ADMIN`; single knexfile. `tenants` + `tenant_addons` are admin-DB.
- Tier-system migration precedent: `server/migrations/20260303100000_tenant_tier_system.cjs` (base, not ee/).

## Key placement decisions (rationale)
- **`essentials` tier** → `packages/types/src/constants/tenantTiers.ts` (`TENANT_TIERS`, `TIER_RANK`) + `tierFeatures.ts`. Base package; harmless/unused in CE.
- **`license_state` migration** → `server/migrations/` (alongside the tier system; the resolver that reads it lives in base `server/src/lib/tier-gating`). Admin DB, singleton row.
- **`resolveSelfHostTier()`** → `server/src/lib/tier-gating/` (base). On EE it runs because `isEnterprise` is true; on CE it's behind the existing `if (!isEnterprise) return;` short-circuit anyway. It calls `verifyLicense` from `packages/licensing`.
- **`verifyLicense` + token contract + public key(s)** → existing `packages/licensing` package (already holds seat-licensing `get-license-usage`). Importable from base server (not EE-gated).
- **Signing CLI** (holds private key) → `ee/` (internal-only). Private key supplied at runtime, never committed.
- **In-app License page** → under the existing EE `msp/licenses` area (EE app code in `ee/server`/`packages/ee`). Physically an EE page (exists on EE build); intentionally NOT wrapped in `eeRuntimeEnabled` — gated by admin RBAC only so an expired install can renew.
- **Session plumbing**: add `effectiveTier` + `eeEnabled` to the next-auth session/JWT callback (find the callback that sets `session.user.plan`).

## Gating mechanics (from spec)
- `eeRuntimeEnabled() = isEnterprise && rank(effectiveTier) > rank('essentials')` (server).
- Client reads `eeEnabled` from `TierContext` (NOT `NEXT_PUBLIC_EDITION`, which is build-inlined to `enterprise` on the appliance image and cannot flip at runtime).
- Choke-point classification:
  - **Module-presence guards** (gate an `import()` of a CE-compiled-out module) → LEAVE as build-time `isEnterprise`.
  - **Surface/feature-exposure gates** (gate whether a user sees an EE page/route/component/affordance) → CONVERT to `eeRuntimeEnabled`/`eeEnabled`.
  - Ambiguous → lock at `essentials` (safe default).

## License token (Component 1)
- Compact signed JWT, **ES256 (ECDSA P-256)**, `jsonwebtoken@9` (direct dep in server + root).
- Header `kid` selects baked-in public key (rotation). Claims: `iss, sub, cust, tier(pro|premium), seats?, iat, exp`.
- Revocation = expiry-only (v1). Not install-bound (v1). `seats` informational (v1).

## Appliance integration (Component 3)
- Setup UI (`ee/appliance/status-ui/app/setup/page.tsx`) + `/api/setup` (`server.mjs`) gain `editionChoice` ('ee'|'ce') + optional `licenseKey` (light JWS format check only; app verifies authoritatively).
- `setup-engine.mjs` writes `appliance-license-seed` Secret (`EDITION_CHOICE`, `LICENSE_TOKEN`).
- sebastian **bootstrap job** (helm `jobs.yaml`) wires the seed Secret → env → upserts `license_state` singleton at first boot.
- `EDITION`/`NEXT_PUBLIC_EDITION` stay `enterprise` (no helm edition change).
- Appliance host-service changes validated **live on the VM** (team preference: no unit tests for appliance host-service).

## Resolved planning decisions
1. Choke-point conversion = **EXHAUSTIVE PARITY** — essentials must match the CE feature set surface-for-surface in v1. Plan must enumerate an inventory and convert every surface gate (plus a default-locked safety net).
2. Control-plane status-UI trial display = **DEFERRED** (future). v1 surfaces trial/license only via the in-app banner + License page.

## Conversion universe (grep inventory, non-test, excl. ee/docs + next.config)
- ~149 distinct files reference edition at runtime; the live conversion targets cluster in:
  - `server/src`: ~62 `NEXT_PUBLIC_EDITION`/`EDITION` reads + ~13 `isEnterprise`.
  - `packages/integrations`: ~15 `NEXT_PUBLIC_EDITION` + ~8 `isEnterprise` (biggest package surface).
  - smaller: packages/clients, packages/email, packages/sla, packages/scheduling, packages/storage, packages/users, packages/core, packages/auth, packages/client-portal, shared/workflow, shared/services, ee/server, ee/packages.
- `FeaturePlaceholder` referenced in ~10 files (the CE fallback surface essentials reuses).
- `getFeatureImplementation()` has 0 call sites today (helper exists in features.ts but unused) — candidate central choke for some conversions.
- Plan structures conversion features per-area (not 149 micro-features); each area gets classify → convert → essentials-parity tests.

## Implementation discoveries (surprising/non-obvious)

### 1. `resolveSelfHostTier` must return `license_expired` (not `trial_expired`) for expired tokens
When a license token is present but expired, `verifyLicense` returns `{ valid:false, reason:'expired' }`.
The resolver originally fell through to the trial check, returning `trial_expired` instead of `license_expired`.
Fix: check `result.reason === 'expired'` explicitly before falling through. Only `malformed`/`bad_signature`/`unknown_kid` should fall through to trial resolution (the token is corrupt/wrong, not truly expired).

### 2. `packages/auth` can't circularly import from `server/src`
`nextAuthOptions.ts` (packages/auth) needed `getLicenseStateRow`/`resolveSelfHostTier`. These were initially put in `server/src/lib/tier-gating/license-state.ts`, but auth can't import from server. Moved the canonical implementation to `packages/licensing` (which has `@alga-psa/db` as a dep). `server/src/lib/tier-gating/license-state.ts` is now a thin re-export.

### 3. `NEXT_PUBLIC_EDITION` is build-time inlined — can't be used for runtime gating
On the EE build (appliance), `NEXT_PUBLIC_EDITION` is always `enterprise` (baked at `ee/server/Dockerfile.build:45`). Flipping it at runtime has no effect. All client surface gates must use `session.user.eeEnabled` (via `useEeEnabled()` hook or `useTier().eeEnabled`).

### 4. Choke-point inventory result: ~124 type-A (module guards), ~14 type-B (surface gates)
The exhaustive inventory found far fewer surface gates than the original ~149-file count suggested. Most usages are module-presence guards for dynamic imports and should remain build-time. The 14 surface gates converted span: 6 in `server/src`, 6 in `packages/integrations`, 1 in `packages/clients`, 1 in `server/src/components/layout/RightSidebar`.

### 5. `RmmIntegrationsSetup` had no outer import anchor — used `RmmIntegrationModal` import as anchor for `useEeEnabled`

### 6. `MicrosoftIntegrationSettings` uses `isMicrosoftConsumerEnterpriseEdition()` in TWO helper functions outside the component body
`getConsumerDescriptors` and `getGuidanceBlocks` both called `isMicrosoftConsumerEnterpriseEdition()` directly. Solution: added `isEnterpriseEdition: boolean` parameter to both functions; component calls `useEeEnabled()` once and passes the value.

### 7. Bootstrap `license_state` seed is guarded by `EDITION_CHOICE` env var presence
The bootstrap script only seeds `license_state` when `EDITION_CHOICE` is set (populated from `appliance-license-seed` Secret). Existing appliances that don't have the seed secret will skip the upsert silently, retaining SaaS/unset behaviour.

### 8. Admin-DB migrations run during appliance bootstrap via knex migrate:latest
The `license_state` migration (20260530100000_create_license_state.cjs) will be picked up automatically by the bootstrap job's `NODE_ENV=migration npx knex migrate:latest` step. No additional wiring needed for F085.

### 9. `essentials` tier uses rank -1 (not shifting existing ranks)
Solo/pro/premium keep their existing ranks (0/1/2). `essentials` is -1. Verified no code compares TIER_RANK values to hardcoded numbers — all comparisons go through `tierAtLeast()` or `TIER_RANK[tier] >= TIER_RANK[min]`.

## Post-implementation review (2026-05-30) — findings + fixes

Adversarial review (3 parallel audits + executable verification) found and FIXED:
- **CRITICAL (build break):** `shared/workflow/runtime/services/workflowStepQuotaService.ts` `TIER_DEFAULT_LIMITS: Record<TenantTier, number>` was missing the new `essentials` key → repo-wide TS2741 compile failure. Added `essentials: 150`. (Confirmed it was the ONLY non-derived tier-keyed literal needing the key.)
- **CRITICAL (deploy break):** `helm/templates/appliance-bootstrap-configmap.yaml` license_state heredoc closing `SQL` was at column 0 in YAML source; inside the `|` block scalar that under-indents below the block and breaks YAML parsing of the whole ConfigMap. Indented closer to 4 spaces (dedents to col 0 in the rendered script). Also added `-v ON_ERROR_STOP=1`. Verified rendered YAML parses + closer lands at col 0.
- **HIGH:** test private key `v1-test.private.pem` was caught by blanket `*.pem` gitignore (untracked despite "committed" docs) → added negation + `git add -f`.
- **HIGH:** `sign.mjs gen-fixture` used `../../` (wrong) → `../../../`; now runs. Fixed stale comments.
- **HIGH (H1):** `TierContext`/`ServerTierGate` resolved tier from `session.user.plan` (NULL→pro), ignoring `effectiveTier` → at essentials the UI behaved as pro (Teams tab, Extensions menu leaked). Now resolve from `effectiveTier ?? plan`. SaaS unaffected (effectiveTier never essentials there).
- **HIGH (H3):** `getTenantTier` called `getLicenseStateRow()` unguarded → 500s if `license_state` table absent during rolling deploy. Wrapped in try/catch (mirrors getActiveAddOns).
- **HIGH (H2):** missed UI surface gates converted to `eeEnabled`: `IntegrationsSettingsPage`, `UserProfile` (calendar tab), `QuickAskOverlay`, `CalendarEnterpriseIntegrationSettings`.
- **MEDIUM (F036):** classified inventory artifact didn't exist → created `CHOKE-POINT-INVENTORY.md`.
- **NITs:** removed dead `eeEnabled` import in LicenseBanner; corrected verifyLicense memoization docstring.

**F038 (now IMPLEMENTED):** server-side enforcement of edition-only EE features via new
`eeRuntimeEnabledServer()` in packages/licensing (`isEnterprise && self-host tier != essentials`,
error-fallback to isEnterprise so hosted EE never disabled). Applied to calendarActions (11 guards),
microsoftActions (getMicrosoftIntegrationStatus → consumer-visibility helpers), and AI chat/ai routes
(completions/stream/execute/document-assist). SaaS unchanged (no row → returns true). Added
`@alga-psa/licensing` dep to packages/integrations; aliased `@alga-psa/core/features` in the licensing
vitest config so the helper's `isEnterprise` import resolves in unit tests. @enterprise platform routes
(extensions etc.) are tier-feature/product/add-on gated, now essentials-aware via assertTierAccess/hasFeature.

Verification after fixes: shared typecheck no longer reports the essentials TS2741 (only pre-existing
missing-module errors remain); 18/18 licensing tests pass; CLI sign + gen-fixture round-trip OK; rendered
bootstrap ConfigMap parses as YAML.

## TODO (fill as we go)
- [x] Locate next-auth session callback that sets `session.user.plan` → found in `packages/auth/src/lib/nextAuthOptions.ts` ~L1685, L1802, L2435, L2547. Session callbacks at L1854, L2600.
- [x] Produce the classified choke-point inventory (first task of Component 2) → ~14 surface gates, ~124 module guards.
- [x] Confirm how admin-DB migrations are executed by the appliance bootstrap → via `npx knex migrate:latest` in appliance-bootstrap-configmap.yaml:309. License_state migration will be picked up automatically.
