# PRD — Modular Dependency Slices (Eliminate Billing ↔ Clients Cycles)

- Slug: `modularity-dependency-slices`
- Date: `2026-01-20`
- Status: Draft

## Summary
We have “domain slice” packages (e.g. `@alga-psa/billing`, `@alga-psa/clients`) intended to be vertically-owned modules. Today, **billing ↔ clients** have a bidirectional dependency that creates circular build graph issues and has prompted dynamic-import “escape hatches”.

This plan introduces a **new lower slice** that *owns the cross-domain surface area* (data access + server actions + (optionally) shared UI primitives) so dependencies go **down** (billing/clients → shared slice), and dynamic imports are removed.

**Scope expansion (2026-01-20):** additional NX build cycles were discovered involving `@alga-psa/ui` importing vertical slice actions/components (e.g. tenancy/users/clients/client-portal). This plan now also covers refactoring UI so it remains a true horizontal “lower slice” (no vertical imports), eliminating `ui ↔ <domain>` cycles that block `nx run-many -t build`.

## Problem
Billing and Clients currently need each other:
- Billing needs client-facing data/actions/components (e.g. client selection, lookups, contracts per client, default tax region).
- Clients need billing domain logic/models (e.g. “reactivate expired contract” when a client contract assignment changes; tax settings UI embeds billing components).

This creates a **bidirectional dependency** which:
- Breaks static dependency analysis (NX graph cycles) and produces brittle build behavior.
- Encourages dynamic import patterns that can mask missing rebuilds and cause runtime-only failures.
- Violates the modularization goal: dependencies should be layered and flow **down**, not sideways.

Separately, `@alga-psa/ui` contains multiple “app feature” components that import vertical slice actions (users/tenancy/clients/client-portal). Because many vertical slices depend on `@alga-psa/ui`, this turns `@alga-psa/ui` into a pseudo-vertical and creates cycles like:
- `... -> auth -> ui -> tenancy -> client-portal -> clients -> ui`

## Goals
- Remove the **billing ↔ clients** bidirectional dependency entirely.
- Replace dynamic-import wrappers with **static imports** from a lower slice so builds and typechecking remain correct.
- Define a clear ownership boundary for “cross-domain” concerns (contracts assignments, client lookup for billing, client tax default region).
- Keep runtime behavior and UX unchanged (refactor only).
- Keep `@alga-psa/ui` “horizontal”: no imports from vertical slices (`@alga-psa/*` domains) so dependency flow is strictly down from features/apps into UI primitives.

## Non-goals
- A full re-architecture of all domain slices across the repo.
- Redesigning billing/contracts or client onboarding UX.
- Consolidating all “tax” concerns across the whole product (scope is only what’s needed to remove the current cycles).
- Performance/observability work beyond what’s needed for safe refactoring.
- Comprehensive new automated test coverage (this effort focuses on restoring deterministic typechecks/builds and removing dependency cycles; build/typecheck checks are the primary validation).

## Users and Primary Flows
Primary persona: internal engineers working on modularization, billing, and clients.

Primary flow:
1. Developer changes code in billing or clients.
2. The correct dependency chain triggers rebuild/typecheck deterministically.
3. No runtime-only failures caused by hidden dynamic imports or missing package builds.

## Proposed Architecture
### “Cross-dependencies” live in `@alga-psa/shared`
Use the existing `@alga-psa/shared` lower slice as the home for the shared surface area between billing and clients.

This shared module should:
- Depend only on lower layers (e.g. `@alga-psa/db`, `@alga-psa/types`, `@alga-psa/core`, `@alga-psa/validation`, `@alga-psa/ui` if UI primitives are moved there).
- Export **server actions** and/or **models** used by both `@alga-psa/billing` and `@alga-psa/clients`.
- Contain the “cross-domain” operations currently duplicated/entangled across slices:
  - Client contract assignment operations backed by `client_contracts` and `contracts` tables (create/update/get/list).
  - Client lookup for billing admin UIs (paginated lists, filtering by billing cycle ranges).
  - Default client tax region code retrieval used by invoice generation.

### Shared UI primitives
Where feasible, move UI components that are “pure UI” (no domain-side imports) into `@alga-psa/ui` so all slices can use them without pulling in a domain package.

In-scope: move `ClientPicker` into `@alga-psa/ui` (it renders a picker but does not fetch clients; it receives `clients` as props).

### UI “feature” code must move up
Any UI code that calls server actions or imports vertical slices must live in the owning vertical slice or in the top-level app (`server` / `client-portal`), not in `@alga-psa/ui`.

Examples of out-of-scope-for-UI patterns:
- `@alga-psa/ui` importing `@alga-psa/tenancy/actions` for tenant settings UI.
- `@alga-psa/ui` importing `@alga-psa/users/actions` for user management/profile UIs.
- `@alga-psa/ui` importing `@alga-psa/clients/actions` for client pickers/lists (UI can accept data via props instead).

### Removing dynamic import escape hatches
After shared modules exist and imports are redirected, remove:
- `packages/billing/src/lib/clientsHelpers.ts` dynamic wrappers.
- `packages/clients/src/lib/billingHelpers.ts` dynamic wrappers (as applicable).
- Any remaining dynamic imports introduced only to break cycles (e.g. importing billing models from clients actions).

## Requirements
### Functional Requirements
- Billing UI can fetch clients and render billing screens without importing from `@alga-psa/clients`.
- Billing backend code can access client default tax region and relevant client data without importing from `@alga-psa/clients`.
- Clients-side operations that require billing contract logic can call into the new shared slice without importing from `@alga-psa/billing`.
- The dependency graph has **no cycles** between `@alga-psa/billing` and `@alga-psa/clients`.
- `@alga-psa/ui` contains only reusable UI primitives/hooks and does not import vertical slices (tenancy/users/clients/client-portal/auth/etc).

### Non-functional Requirements
- **Static dependencies only** across packages; no dynamic import indirection used to bypass the build graph.
- Clear package ownership: cross-domain code lives in the shared slice; billing/clients slices remain vertically-owned.

## Data / API Notes
No schema changes are expected; this is a code movement/refactor.

Server actions currently located in `@alga-psa/clients/actions` that are used by billing UIs should be relocated or wrapped (statically) in the shared slice.

## Risks
- Moving server actions across packages can break import paths in Next.js client/server boundaries (must keep `use server` usage correct).
- Incremental build tools may require updating tsconfig path mappings / package exports.
- UI component moves (e.g. `ClientPicker`) can impact downstream imports across many packages.

## Rollout / Migration Plan
1. Introduce the new shared slice package with a minimal exported surface.
2. Move/refactor the smallest “cycle-causing” APIs first (tax region + client contract assignment).
3. Redirect `@alga-psa/billing` and `@alga-psa/clients` to import from the shared slice (static imports).
4. Remove dynamic import helpers and verify the dependency graph is cycle-free.
5. Optional: move pure UI primitives (e.g. `ClientPicker`) into `@alga-psa/ui` and update imports repo-wide.

## Open Questions
1. What should the `@alga-psa/shared` export surface and module path be for these cross-domain APIs (chosen: `@alga-psa/shared/billingClients`)?

## Acceptance Criteria (Definition of Done)
- No code in `@alga-psa/billing` imports from `@alga-psa/clients` (actions or components).
- No code in `@alga-psa/clients` imports from `@alga-psa/billing` (actions, components, or models).
- No dynamic imports exist solely to break the billing↔clients dependency cycle.
- Dependency tooling (nx graph) reports no billing↔clients cycle **or**, if nx graph is too slow/unavailable in the current environment, we verify via (a) import-greps and (b) `tsc --listFilesOnly` / `--explainFiles` that billing does not compile clients and vice versa.
- `npm run build` (or the relevant package builds) succeeds with correct incremental rebuild behavior (changes in a dependency trigger builds).
- `nx run-many -t build` does not report cycles rooted in `@alga-psa/ui` (e.g. `ui -> tenancy -> client-portal -> clients -> ui`).
