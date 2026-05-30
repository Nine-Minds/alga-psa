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

## TODO (fill as we go)
- [ ] Locate next-auth session callback that sets `session.user.plan`.
- [ ] Produce the classified choke-point inventory (first task of Component 2).
- [ ] Confirm how admin-DB migrations are executed by the appliance bootstrap (sebastian chart).
