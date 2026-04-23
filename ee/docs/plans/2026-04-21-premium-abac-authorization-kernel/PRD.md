# PRD — Advanced Authorization Kernel and Premium ABAC Bundles

- Slug: `premium-abac-authorization-kernel`
- Date: `2026-04-21`
- Status: Draft

## Summary

Build a shared authorization kernel that centralizes the codebase's existing ABAC-like access rules in both CE and EE, then add an EE-only, tier-gated control plane for configurable authorization bundles. The new system keeps RBAC as the prerequisite, preserves built-in security invariants, normalizes relationship-driven access patterns such as **own / assigned / managed / same client / client portfolio / selected boards**, and lets entitled EE tenants apply **narrowing-only** premium restrictions through reusable bundles attached to roles, teams, users, and API keys.

The immediate product value is better differentiation for larger MSPs that need fine-grained segmentation across tickets, documents, time, projects, assets, and billing. The immediate engineering value is replacing today's fragmented mix of RBAC, inline ownership checks, board filters, and API/UI drift with one coherent authorization path.

## Problem

Authorization in the current codebase is split across three layers that do not compose cleanly:

1. **RBAC** is relatively simple and stable: role → permission(`resource`, `action`) with tenant and portal gating.
2. **Relationship- and attribute-driven rules** already exist in many features, but are scattered inline:
   - client-portal board scoping
   - manager/delegation checks for time
   - document ownership/client visibility rules
   - client admin / same-client guards
   - assorted own/assigned/manage checks in projects and other domains
3. **A legacy policy/DSL scaffold** exists, but it is not the authoritative runtime path and has drifted from production behavior.

This creates several problems:

- enterprise MSP segmentation is difficult to express consistently
- UI/server-action and API-key paths can diverge
- own/manage/assigned/client-portfolio logic is reimplemented repeatedly
- there is no single place to explain why access was allowed or denied
- the existing policy DSL is not the right abstraction for how the product actually works

## Goals

1. Introduce a **shared authorization kernel** in CE and EE that centralizes relationship-driven access evaluation, list scoping, single-record authorization, mutation guards, and optional field redaction hooks.
2. Preserve RBAC as the first authorization gate; the new system must **narrow** or shape access after RBAC, not replace it.
3. Normalize the most important built-in relationship semantics already present in the product, especially:
   - own
   - assigned
   - managed
   - same client
   - client portfolio
   - selected boards
4. Converge UI/server-action and API/programmatic paths toward one effective authorization model for the migrated resource families.
5. Ship an **EE-only configurable control plane** that lets entitled tenants create reusable **authorization bundles** and attach them to roles, teams, users, and API keys.
6. Make configurable premium ABAC **narrowing-only**. Configured bundles may further restrict access, but may not broaden RBAC or built-in baseline behavior.
7. Replace the legacy policy DSL direction with **typed relationship-first templates** and bundle-based management.
8. Deliver strong baseline validation by documenting current behavior before migration and verifying parity after cutover.

## Non-goals

1. Replacing RBAC with pure ABAC.
2. Supporting arbitrary custom expressions, a general-purpose policy DSL, or user-authored boolean logic in v1.
3. Allowing EE-configured policies to widen access beyond RBAC or built-in kernel behavior.
4. Introducing allow/deny precedence trees, explicit negative policies, or exception systems in v1.
5. Covering every product resource family in the first configurable rollout.
6. Implementing multi-step human approval workflows for bundle publication in v1.
7. Moving all historical authorization behavior into tenant-configurable policies. Some baseline invariants must remain built in.
8. Solving every extension/integration authorization seam in the first milestone, although the kernel should be designed for later adoption.

## Users and Primary Flows

### Security / platform administrator (EE)
1. Opens the Advanced Authorization area.
2. Creates or edits an authorization bundle such as "Field Technician" or "Assigned Client Delivery Team".
3. Adds narrowing rules across one or more resource families.
4. Simulates the draft bundle against real users/records or synthetic scenarios.
5. Publishes the revision.
6. Assigns the bundle to roles, teams, users, or API keys.

### MSP operations admin / team lead (EE)
1. Needs to segment access by client portfolio, team, assignment, board, or management chain.
2. Uses shipped system bundles or clones them into custom bundles.
3. Applies bundles to operational roles and teams.
4. Uses explainability tooling to understand why a technician can or cannot access a record.

### Support / engineering staff (CE + EE)
1. Uses the shared kernel's decision traces and common behavior model to debug access issues.
2. Confirms that migrated resource families now apply one normalized authorization path.

### Integration administrator (EE)
1. Assigns a narrowing bundle to an API key.
2. Ensures programmatic access is an intersection of user access and API-key restrictions.
3. Validates the effective scope before enabling integrations in production.

## UX / UI Notes

### EE bundle-management experience
1. Primary artifacts are **bundles**, not raw policy rows.
2. Main EE surfaces:
   - Bundle Library
   - Bundle Editor
   - Assignment Manager
   - Access Simulator / Explainability
3. Bundle editing should be organized by **resource sections** (Tickets, Documents, Time, Projects, Assets, Billing), not generic condition grids.
4. All rules should show natural-language summaries.
5. Bundle changes must follow a **draft → publish** model. Published revisions are enforced; draft revisions are not.
6. Assignments attach to the stable bundle, not directly to a draft revision.
7. The simulator should support:
   - real principals + real existing records
   - synthetic scenarios
   - draft-vs-published comparison

### CE / non-entitled EE behavior
1. CE uses the shared kernel for built-in behavior but has no configurable bundle management UI.
2. EE tenants below the required tier should see an upgrade path using the existing tier-gating patterns.
3. Built-in relationship behavior must remain active even when the premium management UI is unavailable.

## Requirements

### Functional Requirements

1. Introduce a shared authorization kernel that exposes common entry points for:
   - single-resource authorization
   - list/query scoping
   - mutation authorization
   - field redaction hooks
   - explainability traces
2. Keep RBAC as a prerequisite. If RBAC denies a `resource:action`, configured ABAC must not restore that access.
3. Normalize built-in relationship resolvers for the most important relationship types used in current product behavior, including own, assigned, managed, same-client, client-portfolio, and selected-board semantics where applicable.
4. Preserve product-defined baseline invariants in CE and EE, even when tenant-configurable premium ABAC is unavailable.
5. Ensure configurable premium ABAC is **narrowing-only**.
6. Provide an EE-only configurable control plane that lets tenants define reusable authorization bundles.
7. Bundles must support rules spanning at least the v1 resource families:
   - tickets
   - documents
   - time
   - projects
   - assets
   - billing
8. Bundles must attach to:
   - roles
   - teams
   - users
   - API keys
9. API-key bundle restrictions must always be an intersection with the impersonated user's effective access.
10. Bundles must be versioned with a draft/publish lifecycle.
11. Editing an active bundle must create or modify a draft revision rather than mutating the enforced revision in place.
12. Publishing a draft revision must atomically make it the enforced revision for all active assignments of that bundle.
13. Bundles must support archive semantics without deleting historical revisions.
14. Bundle assignments must use one generic assignment model keyed by `target_type + target_id`.
15. Assignment creation must validate that the target exists in the same tenant and is compatible with the chosen attachment type.
16. Bundles must compose as **narrowing intersections**, not widening unions.
17. The configurable rule catalog must use typed templates rather than arbitrary expressions.
18. The v1 template catalog must support relationship-first scope templates such as:
   - own
   - assigned
   - managed
   - own_or_assigned
   - own_or_managed
   - client_portfolio / selected_clients
   - same_team
   - selected_boards
19. The v1 constraint catalog must support at least the high-value narrowing guards needed for migrated resource families, including concepts such as:
   - not-self-approver
   - client-visible-only
   - hide-sensitive-fields
20. Provide shipped system bundles / starter bundles for common enterprise MSP scenarios.
21. Replace use of the legacy policy DSL as the primary runtime direction. The new control plane must not depend on end-user DSL authoring.
22. Migrate ticket authorization to the shared kernel for the selected v1 access paths, including list/detail and premium narrowing support where applicable.
23. Migrate document authorization to the shared kernel while preserving current relationship and visibility semantics.
24. Migrate time / timesheet delegation and approval-related authorization to the shared kernel.
25. Migrate project authorization for the selected v1 project/task/comment access paths into the shared kernel.
26. Migrate asset authorization for the selected v1 access paths into the shared kernel, including client/team/assignment segmentation hooks.
27. Migrate billing authorization for the selected quote/invoice/approval visibility and mutation guards into the shared kernel.
28. Normalize migrated API/programmatic paths to use the same effective authorization kernel as UI/server-action paths.
29. Provide explainability output that identifies the builtin rule path and any configured bundle-based narrowing that contributed to a decision.
30. Create and maintain a plan-local current-behavior baseline artifact so the migration can validate end-state behavior against today's real semantics.
31. Treat current-behavior parity as part of the deliverable, not as optional follow-up.

### Non-functional Requirements

1. The shared authorization runtime must work in CE and EE through an edition-aware, pluggable implementation seam.
2. The configurable control plane must be EE-only and tier-gated using the same tenant-tier system already used elsewhere in the product (for example Teams integration support), with **Premium** as the default required tenant tier.
3. The shared runtime interface should avoid scattering `isEnterprise()` branches through feature code; callers should rely on the common authorization contract.
4. The system must fail closed when authorization context or required resource attributes cannot be resolved safely.
5. The new runtime should be designed for request-local caching to avoid repeated relationship and bundle resolution within a request.
6. Runtime cutovers must not silently broaden access for any migrated resource family.
7. Decision traces should be detailed enough to support simulator output, support debugging, and later auditability.
8. The migration must not require immediate removal of every legacy policy/DSL artifact, but the new runtime must not depend on them.
9. The implementation must include database-backed regression coverage for migrated resource families and at least one failure/guard case per high-risk domain.
10. API/UI parity should be validated explicitly for migrated resource families where both channels exist.

## Data / API / Integrations

### Recommended shared runtime shape
The kernel should expose stable entry points such as:
- authorize one resource/action
- resolve effective scope for list/search queries
- assert mutation authorization
- resolve field redactions
- explain why access was allowed or denied

### Recommended configurable control-plane model
Use new, typed authorization tables rather than extending the old policy-DSL model:
- `authorization_bundles`
- `authorization_bundle_revisions`
- `authorization_bundle_rules`
- `authorization_bundle_assignments`

Assignments should key on:
- `target_type`
- `target_id`

### Current baseline artifact
Maintain a plan-local baseline artifact, currently seeded as:
- `CURRENT_AUTHORIZATION_BASELINE.md`

That artifact is the source of truth for current behavior validation during rollout.

## Security / Permissions

1. RBAC remains mandatory.
2. Built-in kernel invariants remain mandatory in both CE and EE.
3. Configured premium ABAC may only narrow access after RBAC and built-in kernel rules have been applied.
4. Programmatic/API key restrictions must never broaden access beyond the impersonated user.
5. Bundle, revision, assignment, publish, and simulator actions must themselves be permission-gated.
6. Assignment validation must be tenant-scoped.
7. Simulator access should expose enough explanation to support governance while avoiding disclosure of unrelated tenant data.
8. Migrated resource families must preserve fail-closed behavior when relationship resolution is incomplete or invalid.

## Observability

Default operational telemetry does not need to expand beyond normal server logs unless implementation reveals a clear operational gap. However, the authorization kernel and EE simulator should provide structured decision reasons that can be surfaced in debugging and governance workflows.

## Rollout / Migration

1. Treat this as a **comprehensive authorization-kernel overhaul** rather than a one-off feature bolt-on.
2. Start by documenting current behavior and locking in regression expectations before large-scale cutovers.
3. Introduce the shared kernel with **built-in behavior only** first so CE and EE can migrate onto one runtime path.
4. Migrate prioritized resource families onto the kernel while preserving existing behavior.
5. Converge API and UI/server-action behavior during resource-family migration rather than leaving parity for later.
6. Add the EE configurable control plane once the shared kernel contract is stable enough to support bundle overlays.
7. Roll configurable narrowing onto the selected v1 resource families after the built-in kernel path is in place.
8. Prefer resource-family cutovers within the comprehensive architecture over a single all-at-once runtime switch.

## Open Questions

1. Which exact project and asset actions are in the first migrated cutover versus a later follow-up inside the same kernel architecture?
2. Which billing fields should participate in v1 redaction, and which should remain out of scope until a later phase?
3. Which existing API surfaces are explicitly in the first parity wave versus a second wave after the shared kernel is established?

## Acceptance Criteria (Definition of Done)

1. A shared authorization kernel exists and is used by migrated CE and EE flows.
2. RBAC remains the prerequisite gate, and configured premium ABAC cannot widen access.
3. The new runtime centrally supports relationship-driven access evaluation for the v1 relationship templates.
4. EE tenants on the **Premium** tier or above can create, revise, publish, and assign narrowing bundles.
5. Bundles can attach to roles, teams, users, and API keys through one generic assignment model.
6. Active bundle enforcement uses only the current published revision; draft revisions are not enforced.
7. The simulator supports both real principals/records and synthetic scenarios.
8. Tickets, documents, time, projects, assets, and billing are migrated onto the shared kernel for the selected v1 paths.
9. API/UI parity is validated for the migrated resource families where both channels exist.
10. `CURRENT_AUTHORIZATION_BASELINE.md` or its updated equivalent captures the real pre-migration behavior needed to validate the rollout.
11. The legacy DSL/policy runtime is no longer the primary runtime direction for the migrated authorization paths.
12. Regression coverage demonstrates that migrated behavior preserves baseline security semantics while allowing entitled EE tenants to add narrowing restrictions through bundles.
