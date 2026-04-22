# Scratchpad — Premium ABAC Follow-up Remediation

- Plan slug: `premium-abac-remediation`
- Created: `2026-04-22`

## What This Is

Keep a lightweight, continuously-updated log of discoveries and decisions made while implementing this plan.

Prefer short bullets. Append new entries as you learn things, and also *update earlier notes* when a decision changes or an open question is resolved.

## Decisions

- (2026-04-22) This is a **follow-up remediation plan** for `ee/docs/plans/2026-04-21-premium-abac-authorization-kernel/`, not a replacement for it.
- (2026-04-22) Scope is limited to defects identified during review of the first implementation session.
- (2026-04-22) Remediation should be **surgical** where possible and should preserve the architecture and product decisions from the original plan.
- (2026-04-22) The most urgent fixes are draft/publish integrity, selected-rule fidelity, starter-bundle publish behavior, time resource-key alignment, simulator fidelity, and API pagination semantics.
- (2026-04-22) `F001` implemented by adding explicit remediation-to-original feature/test mapping to this plan PRD; this follow-up now has auditable traceability to original plan IDs.

## Discoveries / Constraints

- (2026-04-22) `getAuthorizationBundleDraftEditorAction` currently requires only read permission but calls `ensureDraftBundleRevision(...)`, which creates draft state as a side effect.
- (2026-04-22) `upsertBundleRule(...)` and `deleteBundleRule(...)` are currently not scoped tightly enough to the active draft revision, which weakens draft/publish isolation.
- (2026-04-22) Runtime relationship evaluation for `selected_clients` and `selected_boards` depends on evaluation input fields, but the stored rule config is not fully propagated into bundle-rule evaluation objects.
- (2026-04-22) Starter bundle seeding currently creates bundle rules without publishing the initial revision, leaving seeded bundles inert.
- (2026-04-22) Migrated Time UI/catalog uses `time_entry` while selected time/delegation kernel calls currently use `timesheet`.
- (2026-04-22) API list controllers for tickets, projects, and quotes paginate in the service layer first, then narrow in memory, then report filtered-page counts as totals.
- (2026-04-22) Simulator fidelity is weakened by billing-record mismatch and by simulator kernel construction that does not mirror all builtin resource-specific invariants used in real runtime paths.
- (2026-04-22) `server` package tests run directly via `cd server && npx vitest run ...`; root `npm run test:local -- ...` currently fails because its `dotenv` invocation expects a different CLI syntax.
- (2026-04-22) Control-plane schema allows `authorization_bundle_rules.bundle_id` to drift from the referenced revision’s `bundle_id` because rule rows currently only foreign-key revision by `(tenant, revision_id)`.
- (2026-04-22) Runtime rule mapping loaded `constraints`/`redactedFields` from rule config but did not load `selectedClientIds` or `selectedBoardIds`, so selected template rules could evaluate against missing IDs.

## Commands / Runbooks

- (2026-04-22) Inspect original plan scratchpad and feature/test references:
  `read ee/docs/plans/2026-04-21-premium-abac-authorization-kernel/SCRATCHPAD.md`
- (2026-04-22) Review committed implementation history on this branch:
  `git log --oneline --decorate --reverse --ancestry-path $(git merge-base HEAD origin/main)..HEAD`
- (2026-04-22) Review changed files in the premium-ABAC rollout:
  `git diff --stat $(git merge-base HEAD origin/main)..HEAD`
- (2026-04-22) Spot-check known hot files:
  - `server/src/lib/authorization/bundles/service.ts`
  - `ee/server/src/lib/actions/auth/authorizationBundleActions.ts`
  - `server/src/lib/authorization/kernel/providers/bundleProvider.ts`
  - `packages/scheduling/src/actions/timeEntryDelegationAuth.ts`
  - `server/src/lib/api/controllers/Api{Ticket,Project,Quote}Controller.ts`

## Links / References

- Original plan:
  - `ee/docs/plans/2026-04-21-premium-abac-authorization-kernel/PRD.md`
  - `ee/docs/plans/2026-04-21-premium-abac-authorization-kernel/features.json`
  - `ee/docs/plans/2026-04-21-premium-abac-authorization-kernel/tests.json`
  - `ee/docs/plans/2026-04-21-premium-abac-authorization-kernel/SCRATCHPAD.md`
- Key implementation files:
  - `server/src/lib/authorization/bundles/service.ts`
  - `server/src/lib/authorization/kernel/providers/bundleProvider.ts`
  - `server/src/lib/authorization/kernel/relationships.ts`
  - `ee/server/src/lib/actions/auth/authorizationBundleActions.ts`
  - `packages/scheduling/src/actions/timeEntryDelegationAuth.ts`
  - `server/src/lib/api/controllers/authorizationKernel.ts`
  - `server/src/lib/api/controllers/ApiTicketController.ts`
  - `server/src/lib/api/controllers/ApiProjectController.ts`
  - `server/src/lib/api/controllers/ApiQuoteController.ts`
  - `server/migrations/20260421190000_create_authorization_bundle_control_plane.cjs`

## Open Questions

- Should this follow-up fully solve post-authorization pagination totals, or only make pagination semantics honest and fail-safe for now?
- Should simulator fidelity in this follow-up be broadened by modeling builtin resource rules per resource family, or narrowed by explicitly refusing unsupported scenario types?

## Progress Log

- (2026-04-22) Completed `F001`:
  - Added a new `Traceability Mapping` section in `PRD.md` that maps each remediation feature cluster to original-plan feature/test IDs.
  - Purpose: satisfy follow-up-plan auditability and make remediation-to-original linkage explicit in the source-of-truth artifact.
- (2026-04-22) Completed `F002`:
  - Updated `getAuthorizationBundleDraftEditorAction` to check `system_settings:write` capability.
  - Write-capable users keep existing behavior (`ensureDraftBundleRevision`), while read-only users load an existing draft or published revision without creating draft state.
  - Added explicit summary text for read-only fallback when no active draft exists.
- (2026-04-22) Completed `F003`:
  - Hardened `upsertBundleRule` to require a draft revision scoped by `tenant + bundle + revision`.
  - Rule updates now also require `tenant + bundle + revision + rule` match and fail closed when no matching draft rule exists.
- (2026-04-22) Completed `F004`:
  - Hardened `deleteBundleRule` to require `tenant + bundle + revision + rule` match.
  - Delete now fails closed when the rule is not in the expected draft revision scope.
- (2026-04-22) Verification for `F002-F004`:
  - Command: `cd server && npx vitest run src/test/unit/authorization/bundleManagementPermissions.test.ts`
  - Result: pass.
- (2026-04-22) Completed `F005`:
  - Added migration `server/migrations/20260422113000_enforce_authorization_rule_revision_bundle_integrity.cjs`.
  - Enforced unique key on `authorization_bundle_revisions (tenant, bundle_id, revision_id)` and moved rules FK to `(tenant, bundle_id, revision_id)`.
  - Result: a rule can no longer reference a revision from a different bundle.
- (2026-04-22) Verification for `F005`:
  - Command: `cd server && npx vitest run src/test/unit/migrations/authorizationBundleControlPlaneMigration.test.ts`
  - Result: pass.
- (2026-04-22) Completed `F006`:
  - Added selected-client ID normalization/loading from rule config in runtime rule resolution and simulator rule normalization.
  - Supports both camelCase (`selectedClientIds`) and snake_case (`selected_client_ids`) config keys.
- (2026-04-22) Completed `F007`:
  - Added selected-board ID normalization/loading from rule config in runtime rule resolution and simulator rule normalization.
  - Supports both camelCase (`selectedBoardIds`) and snake_case (`selected_board_ids`) config keys.
- (2026-04-22) Completed `F008`:
  - Extended bundle-provider rule type with `selectedClientIds`/`selectedBoardIds`.
  - Updated template evaluation so `selected_clients` and `selected_boards` use rule-scoped configured IDs during decisioning instead of relying on ad hoc caller input.
- (2026-04-22) Verification for `F006-F008`:
  - Command: `cd server && npx vitest run src/test/unit/authorization/bundle.provider.test.ts`
  - Result: pass.
