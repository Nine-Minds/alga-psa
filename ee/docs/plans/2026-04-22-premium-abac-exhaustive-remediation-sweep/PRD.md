# PRD — Premium ABAC Exhaustive Remediation Sweep

- Slug: `premium-abac-exhaustive-remediation-sweep`
- Date: `2026-04-22`
- Status: Draft

## Summary

Create a new, exhaustive remediation plan for the premium-ABAC authorization rollout that preserves the earlier remediation plan as historical record and expands the remaining scope into a full parity, integrity, and validation sweep.

This plan follows and does **not** replace:

- `ee/docs/plans/2026-04-21-premium-abac-authorization-kernel/`
- `ee/docs/plans/2026-04-22-premium-abac-remediation/`

The earlier follow-up plan captured a surgical remediation set. Since then, broader review and additional code inspection have shown that the remaining work is larger and more systematic:

- bundle lifecycle still has concurrency and governance edges
- many non-API server actions remain RBAC-only and bypass record-level narrowing
- some list/count/summary surfaces still compute totals before authorization narrowing or leak counts with no auth at all
- several helper layers still implement a weaker “shadow auth model” instead of reusing the shared kernel
- some linked-subresource surfaces need explicit policy decisions about whether parent access alone is sufficient, or whether child-resource access must also be enforced

This plan turns those findings into one source of truth for an exhaustive remediation sweep, with no intentionally ignored leftover parity gaps in the covered domains.

## Problem

The shared authorization kernel, EE bundle control plane, and many migrated runtime paths are now in place, but the implementation is still uneven across the full surface area of the product.

The biggest remaining problems are structural, not cosmetic:

1. **Lifecycle / control-plane integrity is improved but not fully closed**
   - draft creation still has race windows around revision numbering and rule-copy initialization
   - some lifecycle operations need stronger transactional boundaries and better migration preflights
   - assignment/archive semantics are not fully governed

2. **API controller parity has advanced faster than server-action parity**
   - several REST/API controllers now apply record-level narrowing
   - many package server actions still rely only on RBAC, so users can still read or mutate tenant records they should be narrowed away from

3. **Counts, totals, tree metrics, and summary helpers still leak information**
   - some list endpoints and server actions narrow records after counting or paging
   - some aggregate helpers do not enforce auth at all
   - some tree/count helpers use hardcoded entity-type permissions instead of kernel decisions

4. **Documents still contain multiple parallel permission paths**
   - some document reads are kernel-backed and redacted correctly
   - other URL helpers, folder/content helpers, count helpers, and bulk mutations still use RBAC-only or no auth
   - `documentPermissionUtils` still embodies a weaker, divergent auth model

5. **Assets still have broad RBAC-only action paths**
   - only a few asset surfaces use asset-level narrowing today
   - history, maintenance, relationship, linked-ticket, client-summary, and metric surfaces still bypass record-level authorization

6. **Projects still have major parity gaps outside the main API controllers**
   - `projectActions.ts` is only partially hardened
   - `projectTaskActions.ts` and `projectTaskStatusActions.ts` remain largely RBAC-only
   - several task/status/count helpers can bypass project-level narrowing entirely

7. **Billing quote server actions remain inconsistent with the newer API controller hardening**
   - `getQuote`, `listQuotes`, and `approveQuote` use kernel logic
   - many other quote reads and mutations still perform only RBAC checks
   - quote item operations, conversion helpers, PDF/preview helpers, and lookup-by-converted-record helpers remain exposed

8. **“Leave no stone unturned” requires a finishing artifact, not just scattered fixes**
   - we need an explicit inventory of every reviewed surface, its chosen semantics, the fix status, and the regression coverage proving it

Without this sweep, the product can claim narrowing-only ABAC at the architecture level while still retaining practical bypasses in non-API paths, linked helpers, and aggregate/count surfaces.

## Goals

1. Finish the premium-ABAC remediation as an **exhaustive parity and integrity sweep**, not another surgical pass.
2. Ensure all covered authorization paths follow the same core rule: **effective access = RBAC ∩ builtin kernel ∩ published bundle narrowing**.
3. Remove or bypass “shadow auth” helper logic where it diverges from the shared kernel.
4. Ensure user-visible totals, counts, summaries, and tree metrics are honest under narrowing.
5. Close the highest-risk lifecycle races and stale-state edge cases in the EE bundle control plane.
6. Define and implement explicit semantics for linked and nested surfaces:
   - structural children that inherit parent-resource auth
   - linked child resources that must also satisfy their own resource family rules
7. Produce an auditable close-out artifact showing that every reviewed surface was either fixed, intentionally inherited from another guard, or explicitly ruled out of scope.
8. Preserve historical traceability to the original premium-ABAC plan and the earlier remediation plan.

## Non-goals

1. Inventing new ABAC product capabilities or widening the policy catalog.
2. Replacing the shared kernel architecture or revisiting the decision to abandon the old policy DSL.
3. Introducing broad observability/telemetry/feature-flag work unless needed to validate or safely ship remediation.
4. Solving unrelated application permission systems outside the premium-ABAC-covered domains.
5. Rewriting stable services merely for stylistic consistency when a targeted hardening change is sufficient.

## Users and Primary Flows

### Security/settings administrators
1. Publish and assign authorization bundles.
2. Expect lifecycle operations to be race-safe, draft-safe, and migration-safe.
3. Expect exhaustive parity between simulator, API, and server-action behavior.

### Internal MSP users under narrowing rules
1. Read and mutate tickets, projects, assets, documents, billing records, and time flows.
2. Expect every entry point to honor the same narrowing decision, regardless of whether it is reached through:
   - REST API controller
   - server action
   - linked detail drawer
   - summary card
   - tree/picker/count helper

### API / integration users
1. Use narrowed API keys and expect list totals/pages/subresources to remain coherent.
2. Expect linked lookups and child-resource routes to apply the same narrowing as primary reads.

### Reviewers / future engineers
1. Need one remediation source of truth that explains:
   - what was found
   - what semantics were chosen
   - what files were touched
   - what tests prove the fix

## UX / UI Notes

1. User-visible counts, totals, page counts, tree badges, and dashboard summaries must never imply access to unauthorized data.
2. Empty pages caused by post-page narrowing are a product bug, not just a backend bug.
3. Linked details should not surprise users by showing a parent object but hiding all linked children without a clear reason; the chosen linked-resource semantics must be consistent.
4. This sweep does not require large new admin surfaces, but it does require more trustworthy behavior everywhere the existing UI already exposes authorization-sensitive data.
5. The final remediation artifact should be understandable by humans doing release validation.

## Requirements

### Functional Requirements

#### Bundle lifecycle / control-plane completion

1. Make `ensureDraftBundleRevision(...)` transaction-safe so concurrent draft creation does not fail on revision-number races or leave partially-initialized drafts.
2. Ensure draft revision creation and published-rule copy happen atomically.
3. Tighten EE bundle write flows so `ensureDraft` + `upsert/delete/publish` operate with safe stale-state behavior and actionable failures.
4. Prevent publishing empty or otherwise invalid draft revisions when that would silently remove narrowing.
5. Add explicit preflight failure for duplicate draft/published revision rows before lifecycle uniqueness indexes are created.
6. Provide or document a concrete repair path for drifted rows that block bundle integrity migrations.
7. Prevent active assignments from being created or silently left behind in misleading states for archived bundles.
8. Make assignment-status updates fail loudly when the targeted assignment is missing or invalid.
9. Decide and implement the intended behavior for archiving/unarchiving bundles with existing assignments.
10. Decide and implement the intended behavior for cloning unpublished bundles or draft-only bundles.

#### Billing quote parity

11. Introduce one shared quote-read authorizer for server actions, analogous to the API-controller hardening.
12. Apply quote record-level auth to quote read helpers beyond `getQuote`, including versions, conversion preview, PDF helpers, preview/render helpers, and lookup-by-converted-record helpers.
13. Apply quote record-level auth to quote mutations beyond `approveQuote`, including update, delete, submit-for-approval, request-changes, send/resend/remind, revision creation, and conversion actions.
14. Require quote item operations to validate both:
    - parent quote authorization
    - item-to-quote ownership/integrity
15. Fix `listQuotes` so totals/pages reflect authorized results rather than page-local post-filter counts.
16. Add explicit parity coverage for quote server actions so the API controller and server-action layers cannot drift again.

#### Documents exhaustive remediation

17. Replace remaining RBAC-only document URL helpers (`download`, `preview`, `thumbnail`, `image/view`) with kernel-backed document lookup and authorization.
18. Apply record-level document auth to remaining document mutations, including update/delete, bulk folder moves, visibility changes, association changes, and folder create/delete/rename flows.
19. Apply record-level auth to document content and block-content read/write/delete helpers.
20. Eliminate no-auth or RBAC-only count leaks, including entity document counts, folder stats, and folder-tree count enrichment.
21. Replace or bypass `documentPermissionUtils` where it acts as a weaker, divergent authorization model.
22. Make folder trees, folder counts, and any document-summary metrics use authorized-document semantics only.
23. Decide and implement whether linked entity-scoped folder operations must satisfy only document auth, or both document auth and parent-entity auth.

#### Asset exhaustive remediation

24. Introduce one shared asset-read authorizer and use it consistently across asset server actions.
25. Fix `listAssets` totals/pages so the response matches authorized rows.
26. Apply asset-level auth to all remaining asset reads, including relationships, maintenance schedules, maintenance reports, history, linked tickets, client maintenance summaries, entity-linked asset lists, and summary metrics.
27. Apply asset-level auth to all remaining asset mutations, including update/delete, relationship create/delete, association create/delete, and maintenance create/update/delete/history operations.
28. Decide and implement linked child-resource semantics for asset detail bundles:
    - parent asset read alone for asset-owned structural data
    - intersection with child ticket/document auth where separate resource family rules already exist
29. Ensure asset summary/metric APIs do not expose health/security/warranty/open-ticket information without authorization.

#### Project / phase / task / status exhaustive remediation

30. Finish `projectActions.ts` parity for any remaining phase/detail/status/count/tree surfaces that still rely only on RBAC.
31. Introduce reusable parent-project gating for task, checklist, dependency, resource-assignment, and ticket-link actions.
32. Apply parent-project gating to all `projectTaskActions.ts` mutation and read paths.
33. Apply parent-project gating to all `projectTaskStatusActions.ts` and phase/custom-status flows.
34. Add missing auth to currently zero-check surfaces in project status actions and count helpers.
35. Fix project count/summarization helpers so they do not leak task/status cardinality for narrowed-away projects.
36. Require cross-project operations such as move/duplicate/link flows to authorize both source and target projects correctly.
37. Decide and implement structural-child semantics for project subresources:
    - phases, tasks, checklists, status mappings inherit project auth
    - linked tickets still satisfy ticket-resource auth if exposed as ticket data

#### Remaining migrated resource-family re-audit

38. Re-audit time/delegation flows beyond the prior `time_entry` key fix and capture any remaining RBAC-only or aggregate leaks.
39. Re-audit non-API entry points that reach the same resources already hardened in APIs, including file routes, previews, shared lookup helpers, and composition-layer actions.
40. Re-audit CE/EE helper seams so both sides use the same runtime semantics and do not regress into duplicated auth logic.

#### Validation / close-out artifacts

41. Produce an exhaustive surface inventory in the remediation scratchpad or companion artifact mapping file/function -> chosen auth semantics -> status -> validating tests.
42. Update the authorization baseline / cross-links so a future reviewer can see what the final “current behavior” is after the exhaustive sweep.
43. Ensure every high-risk gap in this plan is covered by at least one regression test or an explicit documented rationale if purely structural/non-user-facing.

### Non-functional Requirements

1. All changes must fail closed.
2. No remediation may widen access beyond the existing RBAC + builtin kernel contract.
3. Count and pagination fixes must prefer correctness over convenience.
4. New helpers should centralize auth decisions instead of creating new parallel permission systems.
5. Regression coverage should be high-signal and domain-grounded, not just source-string tests.
6. The resulting plan folder must be detailed enough that another engineer can execute the sweep without reconstructing the investigation from chat history.

## Data / API / Integrations

Primary files and subsystems implicated by this sweep include:

- Bundle lifecycle / EE actions
  - `server/src/lib/authorization/bundles/service.ts`
  - `ee/server/src/lib/actions/auth/authorizationBundleActions.ts`
  - `server/migrations/20260422113000_enforce_authorization_rule_revision_bundle_integrity.cjs`
  - `server/migrations/20260422143000_enforce_authorization_revision_lifecycle_uniqueness.cjs`

- Billing quote server actions
  - `packages/billing/src/actions/quoteActions.ts`
  - `packages/billing/src/services/quoteConversionService.ts`
  - `packages/billing/src/models/quote.ts`
  - `packages/billing/src/models/quoteItem.ts`

- Documents
  - `packages/documents/src/actions/documentActions.ts`
  - `packages/documents/src/actions/documentContentActions.ts`
  - `packages/documents/src/actions/documentBlockContentActions.ts`
  - `packages/documents/src/lib/documentPermissionUtils.ts`

- Assets
  - `packages/assets/src/actions/assetActions.ts`

- Projects
  - `packages/projects/src/actions/projectActions.ts`
  - `packages/projects/src/actions/projectTaskActions.ts`
  - `packages/projects/src/actions/projectTaskStatusActions.ts`
  - `packages/projects/src/actions/projectTaskCommentActions.ts`

- Existing API hardening references
  - `server/src/lib/api/controllers/ApiTicketController.ts`
  - `server/src/lib/api/controllers/ApiProjectController.ts`
  - `server/src/lib/api/controllers/ApiQuoteController.ts`
  - `server/src/lib/api/controllers/authorizationAwarePagination.ts`

- Shared kernel
  - `server/src/lib/authorization/kernel/**`
  - `server/src/lib/api/controllers/authorizationKernel.ts`
  - `server/src/lib/authorization/kernel/providers/bundleProvider.ts`

## Security / Permissions

1. The governing rule remains: **RBAC grants capability; builtin kernel + bundle rules narrow capability; nothing in this sweep may widen access.**
2. Structural subresources should inherit parent authorization only when they are truly owned by that parent resource family.
3. Linked child resources should require **intersection semantics** where those child resources already have independent policy meaning (for example, linked tickets/documents surfaced from an asset).
4. Aggregate/count/summary helpers are authorization-sensitive and must be treated as first-class security surfaces.
5. File IDs, document IDs, task IDs, quote item IDs, schedule IDs, and status mapping IDs are not authorization boundaries; they must always be resolved back to an authorized parent/resource context.
6. Migration hardening should fail early with actionable repair guidance instead of silently succeeding without constraints.

## Observability

1. No net-new telemetry is required by default.
2. Error messages for lifecycle failures, stale drafts, unauthorized child-resource lookups, and migration preflight failures must stay descriptive and actionable.
3. The remediation scratchpad should serve as the operational/audit log for the sweep.

## Rollout / Migration

1. Preserve the existing remediation plan as history; use this new plan for the exhaustive sweep.
2. Execute the sweep in this order:
   1. finish lifecycle / migration integrity gaps
   2. harden quote and document server actions
   3. harden assets
   4. harden projects / tasks / statuses
   5. re-audit remaining time and linked helper surfaces
   6. finish exhaustive surface inventory + regression matrix
3. Favor small, file-scoped waves that leave the tree in a validated state after each domain.
4. Update baseline artifacts and close-out notes only after the parity sweep is complete enough to describe “current behavior” confidently.

## Open Questions

1. For asset detail bundles and similar linked views, should linked tickets/documents require intersection with their own resource-family auth, or is authorized parent read sufficient for all child payloads?
2. For project-linked ticket/task surfaces, where should the inheritance boundary stop so we do not accidentally weaken existing ticket auth?
3. Should archiving a bundle automatically disable its assignments for data hygiene, or should assignments remain active-but-inert and simply be excluded at evaluation time?
4. When cloning a bundle with no published revision, should the system clone the latest draft intentionally, or reject cloning unpublished bundles to avoid copying in-progress state?
5. Do we want a dedicated close-out artifact in addition to `SCRATCHPAD.md` for the exhaustive surface matrix, or is the scratchpad sufficient if kept structured?

## Acceptance Criteria (Definition of Done)

1. No known high-risk RBAC-only bypass remains in the covered premium-ABAC resource domains.
2. Bundle lifecycle operations are transaction-safe enough that concurrent draft/publish actions do not create silent corruption or misleading state.
3. Quote, document, asset, project, task, and status server actions either:
   - enforce the shared kernel correctly, or
   - are explicitly documented as inheriting a parent-authorized structural surface.
4. User-visible totals, counts, summaries, and page metadata are honest under narrowing.
5. Linked-child semantics are explicitly chosen, implemented, and tested.
6. The plan folder contains a complete enough inventory that a reviewer can confirm no major surfaces were skipped unintentionally.
7. Regression coverage exists for every high-risk gap cluster in this PRD.
8. The plan cross-references the original premium-ABAC plan, the earlier surgical remediation plan, and the newer remediation checkpoint commit(s) so the implementation history remains auditable.
