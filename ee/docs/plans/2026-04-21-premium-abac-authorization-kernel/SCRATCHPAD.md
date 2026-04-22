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
- (2026-04-21) Completed `F028` by replacing EE `PolicyManagement` with a tier-gated Authorization Bundle Library surface:
  - UI: `ee/server/src/components/settings/policy/PolicyManagement.tsx`
  - Actions: `ee/server/src/lib/actions/auth/authorizationBundleActions.ts`
  - Service additions for list/create/clone: `server/src/lib/authorization/bundles/service.ts`
  - Tier feature gate: `TIER_FEATURES.ADVANCED_AUTHORIZATION_BUNDLES` in `packages/types/src/constants/tierFeatures.ts`
- (2026-04-21) `F028` implementation details:
  - Browse/search active+archived bundles from `authorization_bundles`.
  - Clone bundle into new draft-backed custom bundle while copying source revision rules.
  - Archive active bundles.
  - Seed starter bundles into tenant scope via one action.
  - Tier enforcement is server-side (`assertTierAccess`) and client-side (`useTierFeature`) with Premium minimum tier.
- (2026-04-21) Completed `T003` with DB-backed integration coverage in `server/src/test/integration/authorization/bundleRevisionPublishing.integration.test.ts` validating:
  - publish moves previous published revision to archived
  - target draft revision becomes published
  - stable bundle identity and assignment rows are preserved
- (2026-04-21) Validation runbook for `F028` + `T003` checkpoint:
  - `cd packages/types && npx vitest run src/constants/tierFeatures.test.ts --coverage.enabled=false`
  - `mkdir -p server/coverage/.tmp && cd server && npx vitest run --coverage.enabled=false src/test/integration/authorization/bundleRevisionPublishing.integration.test.ts`
  - `cd .. && npx tsc --pretty false --noEmit -p server/tsconfig.json`
- (2026-04-21) Completed `F029` by extending EE policy settings to include a draft-oriented Bundle Editor in resource sections (Tickets, Documents, Time, Projects, Assets, Billing), replacing raw policy text editing:
  - UI editor surface: `ee/server/src/components/settings/policy/PolicyManagement.tsx`
  - Draft editor actions: `getAuthorizationBundleDraftEditorAction`, `upsertAuthorizationBundleDraftRuleAction`, `deleteAuthorizationBundleDraftRuleAction` in `ee/server/src/lib/actions/auth/authorizationBundleActions.ts`
  - Draft helpers in service layer: `ensureDraftBundleRevision`, `listBundleRulesForRevision`, `deleteBundleRule` in `server/src/lib/authorization/bundles/service.ts`
- (2026-04-21) `F029` rationale: enforce draft-first authoring semantics by materializing/rehydrating a draft revision from the currently published revision when no draft exists, then editing only draft rules grouped by resource family.
- (2026-04-21) Completed `F030` by adding human-readable summaries for both bundle-level and rule-level understanding:
  - Rule summaries in editor rows (`Narrow <resource> <action> to ...`) generated in `ee/server/src/components/settings/policy/PolicyManagement.tsx`.
  - Effective bundle summaries in library rows (status + assignment impact text).
  - Draft-vs-published revision summary generated server-side in `getAuthorizationBundleDraftEditorAction` (`ee/server/src/lib/actions/auth/authorizationBundleActions.ts`) and rendered in the editor header.
- (2026-04-21) Completed `F031` by adding an Assignment Manager panel to the EE bundle surface:
  - New action `listAuthorizationBundleAssignmentsAction` resolves assignment targets across role/team/user/api_key with friendly labels.
  - UI now has per-bundle `Assignments` toggle showing grouped assignment cards and status.
  - Files: `ee/server/src/lib/actions/auth/authorizationBundleActions.ts`, `ee/server/src/components/settings/policy/PolicyManagement.tsx`.
- (2026-04-21) Completed `F032` by adding an EE Access Simulator for real principals + existing records:
  - Principal lookup action: `listAuthorizationSimulationPrincipalsAction`.
  - Record lookup action by resource family: `listAuthorizationSimulationRecordsAction`.
  - Simulation execution: `runAuthorizationBundleSimulationAction` compares draft vs published revision decisions with explainability codes.
  - UI: simulator panel in `ee/server/src/components/settings/policy/PolicyManagement.tsx`.
- (2026-04-21) Completed `F033` by extending the simulator with synthetic scenarios:
  - Added synthetic record input (`ownerUserId`, `clientId`, `boardId`, `isClientVisible`) when no real record is suitable.
  - Simulation action now supports `syntheticRecord` payloads and runs the same draft-vs-published decision flow.
- (2026-04-21) Completed `F034` by tightening unavailable/upgrade states for non-entitled contexts:
  - EE tier-gate surface already blocks with `useTierFeature(TIER_FEATURES.ADVANCED_AUTHORIZATION_BUNDLES)`.
  - CE placeholder copy updated (`packages/ee/src/components/settings/policy/PolicyManagement.tsx`) to show Premium upgrade path while clarifying builtin authorization remains active.
- (2026-04-21) Completed `F035` by adding explicit server-side permission/tier gates to bundle management actions:
  - CRUD + editor + simulator + assignment + publish actions all enforce `assertTierAccess(TIER_FEATURES.ADVANCED_AUTHORIZATION_BUNDLES)` plus RBAC permission checks (`system_settings:read|write`).
  - Added write-gated actions for publish and assignment status changes in `ee/server/src/lib/actions/auth/authorizationBundleActions.ts`.
- (2026-04-21) Completed `F036` by exposing an audit-trail read model from persisted bundle metadata:
  - Added `getAuthorizationBundleAuditTrailAction` returning chronological lifecycle events for bundle creation/archive, draft creation, publish events, and assignment changes.
  - Uses existing metadata columns (`created_by`, `updated_by`, `published_by`, timestamps, assignment status) as authoritative audit source.
- (2026-04-21) Completed `F037` for selected server-action paths by moving ticket list/detail authorization to shared kernel checks after RBAC:
  - `packages/tickets/src/actions/ticketActions.ts` now resolves authorization subject context and calls kernel `authorizeResource` for `getTicketsForList` and `getTicketById`.
  - List path applies kernel decision filtering to ticket rows; single-ticket path denies when kernel disallows.
  - Current cut keeps builtin-kernel path for these endpoints; premium ticket bundle overlays are tracked separately in `F039`.
- (2026-04-21) Validation for `F037` path-level cutover:
  - `cd packages/tickets && npx vitest run src/actions/ticketActions.ticketOrigin.test.ts src/actions/ticketActions.moveToBoard.test.ts --coverage.enabled=false`
- (2026-04-21) Completed `F038` by kernelizing selected-board narrowing for client-portal style ticket access in selected ticket action paths:
  - Added client visibility-group board resolution via `getClientContactVisibilityContext(...)`.
  - For client principals, ticket list/detail now pass `selectedBoardIds` into kernel evaluation with `selected_boards` relationship template and fail-closed behavior when visibility context is missing/invalid.
  - Added client-scope guard (`clientId`) alongside board narrowing for list/detail parity.
- (2026-04-21) Completed `F039` by enabling premium bundle overlays on selected ticket list/detail paths:
  - Ticket actions now instantiate kernel with a bundle provider that resolves active published bundle rules for the current principal (`resolveBundleNarrowingRulesForEvaluation`).
  - Bundle template semantics are now enforced in bundle provider (`bundle_template_denied`) by evaluating each matching rule’s relationship template against record context.
  - This enables ticket narrowing from bundle templates like assignment/client/team/selected-board in the migrated ticket paths.
- (2026-04-21) Completed `F040` by migrating selected document server-action list/detail/download paths to the shared kernel:
  - Added shared document auth helpers in `packages/documents/src/actions/documentActions.ts` for principal resolution, relationship-context normalization from `document_associations`, and per-record kernel evaluation.
  - Migrated `getDocument`, `getAllDocuments`, `getDocumentsByEntity`, `getDocumentsByFolder`, and `downloadDocument` to run `authorizeResource` through the kernel after RBAC.
  - Preserved client-user semantics by enforcing `own OR same_client` relationship checks plus fail-closed `is_client_visible` guard on non-owned records.
- (2026-04-21) Completed `F041` by enabling premium document bundle overlays on migrated document paths:
  - Document actions now instantiate a bundle provider backed by `resolveBundleNarrowingRulesForEvaluation(...)`.
  - Document record context passed to kernel now includes `clientId`, `teamIds`, and `is_client_visible`, enabling client/portfolio-style narrowing and `client_visible_only` enforcement where configured.
- (2026-04-21) Completed `F042` by wiring document field-redaction hooks into migrated document surfaces:
  - Migrated list/detail document actions now apply kernel-provided `redactedFields` to returned document payloads without mutating allow/deny behavior.
  - Redaction plumbing is centralized via `authorizeAndRedactDocuments(...)`.
- (2026-04-21) Validation runbook for `F040`-`F042` checkpoint:
  - `cd packages/documents && npx tsc --pretty false --noEmit -p tsconfig.json`
  - `cd .. && npx tsc --pretty false --noEmit -p server/tsconfig.json`
  - `cd server && npx vitest run src/test/unit/authorization/kernel.engine.test.ts src/test/unit/authorization/bundle.provider.test.ts --coverage.enabled=false`
- (2026-04-21) Completed `F043` by kernelizing selected time/timesheet delegation checks through shared relationship semantics:
  - `packages/scheduling/src/actions/timeEntryDelegationAuth.ts` now resolves managed scope (`teams` manager + optional reports-to chain) and evaluates non-self delegation with kernel `managed` relationship templates via `authorizeResource`.
  - Preserved delegation hierarchy: `self` short-circuit, `timesheet:approve` prerequisite, `timesheet:read_all` tenant-wide override, then manager/reports-to managed scope.
  - `fetchTimeSheetsForApproval` now uses the same managed-subject resolver to scope approval list visibility consistently with delegation rules.
- (2026-04-21) Validation runbook for `F043` checkpoint:
  - `cd packages/scheduling && npx tsc --pretty false --noEmit -p tsconfig.json`
  - `cd .. && npx tsc --pretty false --noEmit -p server/tsconfig.json`
  - `cd packages/scheduling && npx vitest run tests/timeEntryCrud.changeRequests.test.ts tests/timeSheetClient.reopen.test.tsx --coverage.enabled=false` (known pre-existing failure in `T012` mock chain: `db(...).leftJoin is not a function`)
- (2026-04-21) Completed `F044` by enabling premium time narrowing overlays in delegation evaluation:
  - `assertCanActOnBehalf` now composes built-in delegation and premium bundle narrowing by adding `BundleAuthorizationKernelProvider` with `resolveBundleNarrowingRulesForEvaluation(...)`.
  - For `timesheet:read_all` principals, builtin delegation now allows broad scope, while bundle templates can narrow that scope (for example to managed-only/self-only behavior) without widening baseline RBAC/delegation.
  - Result scope classification remains explicit (`manager` when subject is in managed set, otherwise `tenant-wide` only when read-all plus kernel allow).
- (2026-04-21) Validation runbook for `F044` checkpoint:
  - `cd packages/scheduling && npx tsc --pretty false --noEmit -p tsconfig.json`
  - `cd .. && npx tsc --pretty false --noEmit -p server/tsconfig.json`
- (2026-04-21) Completed `F045` by kernelizing not-self-approver checks in selected time approval flows:
  - Added `assertCanApproveSubject(...)` in `packages/scheduling/src/actions/timeEntryDelegationAuth.ts`, which composes delegation checks with kernel `authorizeMutation` for `approve` mutations.
  - Added a built-in mutation guard (`timesheet_not_self_approver_denied`) and bundle-aware mutation overlay evaluation (`not_self_approver` constraint) so approval gating is centralized in kernel semantics.
  - Wired approval paths to the new guard:
    - `packages/scheduling/src/actions/timeSheetActions.ts` (`approveTimeSheet`, `bulkApproveTimeSheets`)
    - `packages/scheduling/src/actions/timeEntryCrudActions.ts` (`updateTimeEntryApprovalStatus` when transitioning to `APPROVED`)
- (2026-04-21) Validation runbook for `F045` checkpoint:
  - `cd packages/scheduling && npx tsc --pretty false --noEmit -p tsconfig.json`
  - `cd .. && npx tsc --pretty false --noEmit -p server/tsconfig.json`
- (2026-04-21) Completed `F046` by migrating selected project comment authorization semantics to kernel evaluation:
  - `packages/projects/src/actions/projectTaskCommentActions.ts` now enforces non-internal comment edit/delete access via kernel `own` relationship evaluation on the comment owner record.
  - Preserved prior behavior exactly for internal users (retain full edit/delete capability), while non-internal users must satisfy `own` semantics through the shared kernel path.
  - This captures the targeted v1 own-comment/internal-user seam under shared authorization contracts.
- (2026-04-21) Validation runbook for `F046` checkpoint:
  - `cd packages/projects && npx tsc --pretty false --noEmit -p tsconfig.json`
  - `cd .. && npx tsc --pretty false --noEmit -p server/tsconfig.json`
  - `cd packages/projects && npx vitest run src/actions/projectPhaseStatusActions.contract.test.ts src/actions/projectPhaseStatusCopyRemove.contract.test.ts --coverage.enabled=false` (known pre-existing contract drift in `projectTaskStatusActions.ts` expectation: missing literal `async function getScopedProjectStatusMappings(`)
- (2026-04-21) Completed `F047` by enabling premium bundle narrowing on selected project list/detail surfaces:
  - `packages/projects/src/actions/projectActions.ts` now evaluates `getProjects` and `getProject` through kernel `authorizeResource` with `BundleAuthorizationKernelProvider`.
  - Added project record normalization for bundle template matching (`assigned_to`, `client_id`, optional `assigned_team_id`) and per-request subject context resolution (roles/teams/managed users/client).
  - Result: published bundle templates for assignment/client/team scope now narrow project visibility on these migrated read paths.
- (2026-04-21) Validation runbook for `F047` checkpoint:
  - `cd packages/projects && npx tsc --pretty false --noEmit -p tsconfig.json`
  - `cd .. && npx tsc --pretty false --noEmit -p server/tsconfig.json`
