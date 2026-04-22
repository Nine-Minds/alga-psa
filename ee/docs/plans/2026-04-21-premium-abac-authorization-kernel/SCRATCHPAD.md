# Scratchpad — Advanced Authorization Kernel and Premium ABAC Bundles

- Plan slug: `premium-abac-authorization-kernel`
- Created: `2026-04-21`

## What This Is

Keep a lightweight, continuously-updated log of discoveries and decisions made while implementing this plan.

Prefer short bullets. Append new entries as you learn things, and also *update earlier notes* when a decision changes or an open question is resolved.

## Decisions

- (2026-04-21) The product direction is a **comprehensive authorization-kernel overhaul** rather than a small ABAC bolt-on.
- (2026-04-21) The design should follow the **ALGA plan** approach with `PRD.md`, `features.json`, `tests.json`, and `SCRATCHPAD.md` under `ee/docs/plans/`.
- (2026-04-21) The old policy DSL should be treated as abandoned scaffolding and **not** evolved into the main runtime direction.
- (2026-04-21) Configurable ABAC should use **admin-configurable templates**, not arbitrary expressions.
- (2026-04-21) The most important first-class relationship concepts are **owns / manages / assigned / same client / client portfolio / selected boards**.
- (2026-04-21) Configured premium ABAC is **narrowing-only**; it must never widen access beyond RBAC + built-in kernel behavior.
- (2026-04-21) The shared authorization runtime should exist in **CE and EE** so existing ABAC-like product rules can be normalized without forking security behavior by edition.
- (2026-04-21) The **EE-only seam** is the configurable control plane: bundle CRUD, assignments, publishing, simulation, and governance UX.
- (2026-04-21) Configurable premium ABAC management is officially gated at the existing **Premium** tenant tier by default.
- (2026-04-21) The packaging model should mirror existing EE plugin/provider seams: one stable interface, CE builtin implementation, EE configurable implementation.
- (2026-04-21) Bundle assignments should support **roles, teams, users, and API keys**.
- (2026-04-21) Bundle assignments should use **one generic assignment table** keyed by `target_type + target_id`.
- (2026-04-21) Bundle changes should use a **draft → publish** model rather than editing active policy in place.
- (2026-04-21) The primary admin artifact should be a **bundle**, not a raw policy row.
- (2026-04-21) The first configurable resource families are **tickets, documents, time, billing, projects, and assets**, with API-key scoping treated as cross-cutting.
- (2026-04-21) The EE simulator should support both **real principals/records** and **synthetic scenarios**.
- (2026-04-21) The migration must explicitly document and validate **current behavior parity** before and after cutover.

## Discoveries / Constraints

- (2026-04-21) Core RBAC is currently centered in `server/src/lib/auth/rbac.ts` and `packages/db/src/models/user.ts` via role/permission lookup plus MSP/client portal gating.
- (2026-04-21) There are multiple copies of RBAC and policy-engine code (`server`, `packages/auth`, `packages/tags`, `ee/server`), which reinforces the need for a single shared runtime contract.
- (2026-04-21) The codebase already contains important production ABAC-like behavior that should become built-in kernel rules rather than optional premium overlays.
- (2026-04-21) `packages/tickets/src/lib/clientPortalVisibility.ts` is the clearest existing shared scope-filter example and is a strong model for list/query narrowing.
- (2026-04-21) `packages/scheduling/src/actions/timeEntryDelegationAuth.ts` already expresses a high-value managed-hierarchy relationship model (`self`, `manager`, `tenant-wide`).
- (2026-04-21) `server/src/app/api/documents/view/[fileId]/route.ts` contains a large amount of inline relationship/visibility logic that should be kernelized carefully and fail-closed.
- (2026-04-21) `packages/client-portal/src/actions/client-portal-actions/visibilityGroupActions.ts` demonstrates same-client and client-admin relationship guards that belong in the shared kernel, not only in premium configuration.
- (2026-04-21) API-key-backed controllers such as `server/src/lib/api/controllers/ApiBaseController.ts` and `ApiTicketController.ts` are mostly RBAC-only today and are a likely parity gap compared with UI/server-action flows.
- (2026-04-21) There is a legacy `policies` table and policy UI scaffolding, but runtime evaluation does not appear to rely on it as the authoritative production path.
- (2026-04-21) The dev seed `server/seeds/dev/49_policies.cjs` references stale concepts like `department`, confirming drift in the old DSL path.
- (2026-04-21) Existing EE gating patterns already exist in the repo:
  - edition detection via `server/src/lib/features.ts`
  - tier gating via `server/src/lib/tier-gating/assertTierAccess.ts` and `ServerTierGate.tsx`
  - feature-tier mapping in `packages/types/src/constants/tierFeatures.ts`
  - Teams-style availability logic in `packages/integrations/src/lib/teamsAvailability.ts`
- (2026-04-21) The product already uses stable CE/EE entrypoint aliasing (for example `packages/product-auth-ee/{oss,ee}/entry*`), which is the preferred packaging pattern for the configurable authorization seam.

## Commands / Runbooks

- (2026-04-21) Search for RBAC/ABAC-related code and existing inline rules:
  `rg -n --hidden --glob '!node_modules' --glob '!dist' "\bABAC\b|attribute[- ]based|access policy|policy engine|scope filter|row[- ]level|hasPermission\(|role_permissions|permissions|is_client_admin|portal_visibility_group_id|isInReportsToChain|approval_status|is_client_visible" packages server ee`
- (2026-04-21) Find policy-engine and legacy DSL scaffolding:
  `rg -n --hidden --glob '!node_modules' --glob '!dist' "class PolicyEngine|evaluateAccess\(|parsePolicy|policyActions|policies\b" packages server ee`
- (2026-04-21) Inspect current Teams-style edition/tier gating references:
  `rg -n --hidden --glob '!node_modules' --glob '!dist' "tier-gating|TIER_FEATURES|Teams integration|teamsAvailability|isEnterprise" packages server ee`
- (2026-04-21) Scaffold an ALGA plan folder:
  `python3 /Users/roberisaacs/.agents/skills/alga-plan/scripts/scaffold_plan.py "Advanced Authorization Kernel and Premium ABAC Bundles" --slug premium-abac-authorization-kernel`

## Links / References

- `packages/auth/src/lib/getSession.ts`
- `packages/auth/src/lib/getCurrentUser.ts`
- `packages/auth/src/lib/withAuth.ts`
- `server/src/lib/auth/rbac.ts`
- `packages/db/src/models/user.ts`
- `packages/tickets/src/lib/clientPortalVisibility.ts`
- `packages/scheduling/src/actions/timeEntryDelegationAuth.ts`
- `server/src/app/api/documents/view/[fileId]/route.ts`
- `packages/client-portal/src/actions/client-portal-actions/visibilityGroupActions.ts`
- `server/src/lib/api/controllers/ApiBaseController.ts`
- `server/src/lib/api/controllers/ApiTicketController.ts`
- `packages/auth/src/actions/policyActions.ts`
- `packages/product-auth-ee/oss/entry.tsx`
- `packages/product-auth-ee/ee/entry.ts`
- `server/src/lib/features.ts`
- `server/src/lib/tier-gating/assertTierAccess.ts`
- `server/src/lib/tier-gating/ServerTierGate.tsx`
- `packages/types/src/constants/tierFeatures.ts`
- `packages/integrations/src/lib/teamsAvailability.ts`
- `ee/docs/plans/2026-04-21-premium-abac-authorization-kernel/CURRENT_AUTHORIZATION_BASELINE.md`
- `context.md`
- `research.md`

## Open Questions

- Which exact project and asset surfaces are in the first migration wave under the shared kernel versus the second wave?
- Which billing fields participate in v1 redaction, and which wait for a later phase?
- Which API surfaces are in the first parity wave once the shared kernel exists?

## Progress Log

- (2026-04-21) Completed `F001`: validated and retained `CURRENT_AUTHORIZATION_BASELINE.md` as the parity contract for tickets/documents/time/projects/assets/billing/client-portal/API-key behaviors.
- (2026-04-21) Completed `F002` by introducing a shared kernel contract at `server/src/lib/authorization/kernel/contracts.ts` with common entry points for single-resource authorization, scope resolution, mutation authorization, field redactions, and explainability.
- (2026-04-21) Completed `F003` with CE builtin provider `BuiltinAuthorizationKernelProvider` (`server/src/lib/authorization/kernel/providers/builtinProvider.ts`) that evaluates only builtin product rules.
- (2026-04-21) Completed `F004` by introducing bundle overlay provider plumbing (`BundleAuthorizationKernelProvider`) plus EE kernel factory (`ee/server/src/lib/authorization/kernel.ts`) and CE stub seam (`packages/ee/src/lib/authorization/kernel.ts`).
- (2026-04-21) Completed `F005` with edition-aware runtime loading (`server/src/lib/authorization/kernel/enterpriseEntry.ts` + `index.ts`) so callers use one kernel interface without `isEnterprise()` branching.
- (2026-04-21) Completed `F006`: kernel engine now hard-gates on RBAC first (`server/src/lib/authorization/kernel/engine.ts`) before builtin/bundle narrowing logic.
- (2026-04-21) Completed `F007` via shared relationship template evaluators in `server/src/lib/authorization/kernel/relationships.ts` for `own`, `assigned`, `managed`, `same_client`, `client_portfolio`, `same_team`, and `selected_boards`.
- (2026-04-21) Completed `F008` with explicit intersection composition in `server/src/lib/authorization/kernel/scope.ts` (`intersectAuthorizationScopes`).
- (2026-04-21) Completed `F009` by adding shared mutation-guard evaluation through builtin provider hooks and `authorizeMutation` in the kernel engine.
- (2026-04-21) Completed `F010` by adding shared redaction hook support through `resolveFieldRedactions` and provider-level field redaction resolvers.
- (2026-04-21) Completed `F011` by emitting structured stage-aware reasons (`rbac`, `builtin`, `bundle`, `mutation`, `redaction`) in every decision path.
- (2026-04-21) Completed `F012` with request-local memoization support (`RequestLocalAuthorizationCache`) and RBAC memoization in the kernel engine.
- (2026-04-21) Validation runbook for this checkpoint:
  - `cd server && npx vitest run src/test/unit/authorization/kernel.engine.test.ts src/test/unit/authorization/kernel.relationships.test.ts`
  - `cd .. && npx tsc --pretty false --noEmit -p server/tsconfig.json`
- (2026-04-21) Completed `F013`: added regression boundary test `server/src/test/unit/authorization/kernel.legacyDirection.test.ts` to enforce that the new kernel path does not import legacy policy DSL runtime modules; this codifies the cutover direction before resource-family migrations.
- (2026-04-21) Completed `F014`-`F017` with migration `server/migrations/20260421190000_create_authorization_bundle_control_plane.cjs` introducing `authorization_bundles`, `authorization_bundle_revisions`, `authorization_bundle_rules`, and generic `authorization_bundle_assignments`.
- (2026-04-21) Completed `F018` with tenant-scoped assignment target validation in `createBundleAssignment(...)` (`server/src/lib/authorization/bundles/service.ts`) for role/team/user/api_key targets.
- (2026-04-21) Completed `F019`-`F021` by modeling lifecycle states (`active/archived`, `draft/published/archived`, `active/disabled`) plus transactional publish, bundle archive, and assignment enable/disable service operations.
- (2026-04-21) Completed `F022` and `F023` with bundle-resolution logic that aggregates active role/team/user/api_key assignments, resolves published revision rules, and applies them through kernel intersection semantics.
- (2026-04-21) Completed `F024` and `F025` via typed catalog enforcement in `server/src/lib/authorization/bundles/catalog.ts` and expanded relationship template support (`own_or_assigned`, `own_or_managed`, `selected_clients`).
- (2026-04-21) Completed `F026` by adding support hooks for `not_self_approver`, `client_visible_only`, and `hide_sensitive_fields` constraint behavior in bundle evaluation.
- (2026-04-21) Completed `F027` by shipping starter bundle definitions in `server/src/lib/authorization/bundles/starterBundles.ts` for assigned-client technician, project delivery team, time manager, restricted asset operator, and finance reviewer scenarios.
- (2026-04-21) Completed `T001` and `T002`:
  - `T001`: baseline artifact validated and maintained.
  - `T002`: migration contract test added at `server/src/test/unit/migrations/authorizationBundleControlPlaneMigration.test.ts` to assert control-plane schema shape and narrowing-only constraints.
- (2026-04-21) Additional validation runbook for this checkpoint:
  - `cd server && npx vitest run src/test/unit/authorization/kernel.engine.test.ts src/test/unit/authorization/kernel.relationships.test.ts src/test/unit/authorization/kernel.legacyDirection.test.ts src/test/unit/authorization/bundle.catalog.test.ts src/test/unit/authorization/bundle.provider.test.ts src/test/unit/authorization/starterBundles.test.ts src/test/unit/migrations/authorizationBundleControlPlaneMigration.test.ts`
  - `cd .. && npx tsc --pretty false --noEmit -p server/tsconfig.json`
