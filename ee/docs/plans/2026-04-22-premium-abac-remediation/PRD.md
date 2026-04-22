# PRD — Premium ABAC Follow-up Remediation

- Slug: `premium-abac-remediation`
- Date: `2026-04-22`
- Status: Draft

## Summary

Address the highest-risk issues found during review of the initial premium-ABAC implementation so the authorization kernel and EE bundle control plane are safe, internally consistent, and faithful to the original design. This follow-up plan is explicitly a remediation plan for the work tracked in:

- `ee/docs/plans/2026-04-21-premium-abac-authorization-kernel/`

The scope of this follow-up is to fix control-plane integrity bugs, restore configured rule fidelity for selected-client / selected-board templates, make starter bundles actually enforceable, align time-resource bundle matching, improve simulator fidelity, and correct API pagination semantics where post-query authorization filtering currently produces misleading or incomplete results.

## Problem

The first premium-ABAC implementation established the shared kernel, bundle control plane, migrated resource paths, and extensive coverage. Review found several concrete defects that materially weaken correctness or make portions of the feature set misleading:

1. **Draft/publish integrity gap**
   - draft editor reads can create draft revisions under read permission
   - rule update/delete paths are not scoped tightly enough to the current draft revision
2. **Selected-client / selected-board bundle rules are not fully wired through runtime evaluation**
   - configured rule values are not propagated into bundle-template evaluation
3. **Starter bundles are seeded as drafts and therefore do not enforce anything**
4. **Time bundle resource naming is inconsistent**
   - Time editor/bundle catalog uses `time_entry`
   - migrated delegation/approval kernel paths use `timesheet`
5. **API list endpoints paginate before authorization narrowing and then report filtered-page counts as totals**
   - pagination metadata is misleading
   - accessible records can become unreachable on later pages
6. **Simulator fidelity gaps**
   - billing simulation loads the wrong backing entity
   - simulation compares bundle overlays without mirroring the same builtin resource-specific invariants as real runtime paths

These issues undermine parts of the original plan, especially the promises around draft/publish safety, typed template correctness, starter-bundle usability, simulator trustworthiness, and API/UI parity.

## Goals

1. Restore **draft/publish integrity** so only write-authorized users can create draft revisions and rule mutations cannot touch published or out-of-scope revisions.
2. Make `selected_clients` and `selected_boards` bundle templates fully functional in runtime evaluation and simulation.
3. Ensure seeded starter bundles are immediately usable by publishing their initial revision correctly.
4. Align time-resource bundle evaluation so premium Time rules actually apply to the intended migrated flows.
5. Make API read pagination semantics safe and predictable under authorization narrowing.
6. Make simulator output faithful enough to be trusted for real-world configuration decisions.
7. Add targeted regression coverage for every remediated defect.
8. Link each remediation item back to the original authorization-kernel plan features/tests so the plan-of-record stays traceable.

## Non-goals

1. Re-architecting the entire premium-ABAC system again.
2. Expanding the bundle template catalog beyond what is necessary to fix current defects.
3. Adding new resource-family migrations beyond the already implemented surfaces.
4. Solving every remaining parity gap across every API sub-endpoint in this follow-up unless needed to correct broken pagination or clearly incorrect scope behavior.
5. Reopening the high-level product design decisions from the original plan.

## Users and Primary Flows

### Security/settings administrator
1. Opens the Authorization Bundle Library and Bundle Editor.
2. Reads bundle drafts without causing unexpected writes unless they have write access.
3. Edits only the active draft revision of a bundle.
4. Seeds starter bundles and expects them to be immediately publish-backed and enforceable.
5. Uses the simulator and expects results that match real runtime behavior closely enough to trust configuration decisions.

### Integration / API consumer administrator
1. Calls migrated API list endpoints under API-key bundle restrictions.
2. Expects page metadata and accessible records to be consistent under narrowing.

### Time approver / manager
1. Configures premium Time restrictions through the UI.
2. Expects Time bundle rules to affect the migrated time/delegation paths they were designed for.

## UX / UI Notes

1. Bundle Editor read flows must not create draft state for read-only users.
2. Starter bundle seeding should not leave the UI in a confusing “available but inert” state.
3. Simulator output should clearly distinguish draft vs published decisions and remain aligned with actual runtime resource semantics.
4. No new net-new admin surfaces are required; this is primarily a correctness and trustworthiness follow-up for the existing EE UI.

## Requirements

### Functional Requirements

1. Restrict draft-creation side effects to write-authorized flows only.
2. Scope bundle rule update/delete operations to the correct tenant, bundle, and current draft revision.
3. Prevent published-rule mutation through draft-only action paths.
4. Persist and load `selectedClientIds` and `selectedBoardIds` so `selected_clients` and `selected_boards` templates evaluate against configured values at runtime.
5. Ensure bundle-provider evaluation uses rule-level selected IDs instead of relying only on ad hoc evaluation input wiring.
6. Publish starter bundle revisions when seeding starter bundles so seeded bundles are immediately enforceable.
7. Align migrated time/delegation premium bundle evaluation with the resource key used by the bundle catalog/editor (`time_entry`) or otherwise align both sides consistently.
8. Correct billing simulator record loading so it matches the migrated billing authorization surface under review.
9. Make simulator kernel construction accurately represent the relevant builtin resource-specific rules for the supported simulation resource families, or explicitly narrow simulator scope to only scenarios it can model faithfully.
10. Correct migrated API list pagination so totals/page semantics do not misrepresent authorized results after narrowing.
11. Ensure remediated API list behavior does not make authorized records unreachable purely because authorization filtering happened after page slicing.
12. Add regression coverage proving the remediations work and remain fixed.
13. Update the original plan scratchpad/progress references if needed so the implementation history remains auditable.

### Non-functional Requirements

1. Remediation should be minimal and surgical where possible; avoid destabilizing already-correct kernel behavior.
2. Draft/publish integrity fixes must fail closed.
3. Simulator fidelity should improve toward “trusted preview,” not just “best effort.”
4. New tests should be targeted, high-signal, and mapped back to the original feature/test IDs they protect.

## Data / API / Integrations

This remediation plan is tied to the original plan’s control-plane and runtime structures:

- `authorization_bundles`
- `authorization_bundle_revisions`
- `authorization_bundle_rules`
- `authorization_bundle_assignments`
- shared kernel runtime under `server/src/lib/authorization/kernel/**`
- EE actions/UI under `ee/server/src/lib/actions/auth/**` and `ee/server/src/components/settings/policy/**`
- migrated API controllers under `server/src/lib/api/controllers/**`

Original-plan areas most directly affected:
- `F019`–`F026` (revision lifecycle, bundle resolution, template/constraint handling)
- `F027` (starter bundles)
- `F028`–`F035` (bundle management surfaces and simulator)
- `F043`–`F045` (time kernelization)
- `F053`–`F056` (selected API parity / regression safety)
- `T003`–`T006`, `T010`–`T014`, `T017`–`T019`, `T024`–`T030`

## Traceability Mapping

This follow-up maps each remediation item back to original-plan feature/test IDs:

- `F001` -> Original traceability anchors: `F019-F026`, `F027`, `F028-F035`, `F043-F045`, `F053-F056`, `T003-T006`, `T010-T014`, `T017-T019`, `T024-T030`
- `F002-F005` -> Original `F019`, `F020`, `F028`, `F029`, `F031`, `T003`, `T024`
- `F006-F008` -> Original `F026`, `F037`, `F039`, `F047`, `T013`, `T020`
- `F009` -> Original `F027`, `T012`
- `F010` -> Original `F043`, `F044`, `F045`, `T017`, `T018`, `T019`
- `F011-F013` -> Original `F032`, `F033`, `T010`
- `F014-F018` -> Original `F053`, `F054`, `F056`, `T014`
- `F019-F024` -> Remediation regression coverage for original `T003-T006`, `T010`, `T012-T014`, `T017-T019`

## Security / Permissions

1. Read-only bundle-management flows must not create or modify draft revisions.
2. Draft-only actions must not mutate published revisions directly or indirectly.
3. Starter bundle seeding must preserve existing tier and security-settings permission gates.
4. Selected-client / selected-board rules must fail closed when configured values are missing or mismatched.
5. API pagination fixes must not broaden access or leak counts from unauthorized records.

## Observability

No new telemetry is required by default. However, simulator and runtime decision reasons must remain rich enough to debug the remediated behaviors.

## Rollout / Migration

1. This plan is a follow-up remediation to the original authorization-kernel rollout, not a standalone feature.
2. Fix control-plane integrity first.
3. Then fix selected-rule fidelity and starter-bundle enforcement.
4. Then fix simulator fidelity and time-resource alignment.
5. Finally fix API pagination semantics and validate parity coverage.
6. Update the original plan’s scratchpad or cross-links as needed to record the remediation outcome.

## Open Questions

1. Should API list remediation compute fully accurate post-authorization totals in this follow-up, or is it sufficient to return pagination metadata that explicitly reflects the narrowed page window until deeper query-level scoping is implemented?
2. For simulator fidelity, do we model builtin rules per resource family immediately, or do we narrow the supported simulator scenarios to the subset we can model exactly in this follow-up?

## Acceptance Criteria (Definition of Done)

1. Draft editor reads no longer create draft state for read-only users.
2. Draft rule create/update/delete paths cannot mutate rules outside the active draft revision for the target bundle.
3. Selected-client and selected-board bundle rules evaluate against their configured values in real runtime paths.
4. Seeded starter bundles create enforceable published revisions.
5. Premium Time bundle rules apply consistently to the migrated time/delegation paths.
6. Billing simulation references the same kind of record the migrated billing authorization path actually uses.
7. Simulator behavior is either aligned with builtin runtime invariants for supported resource families or explicitly constrained to honest supported cases.
8. Migrated API list endpoints no longer return misleading pagination metadata caused by post-page authorization filtering.
9. Targeted regression tests cover each remediated defect.
10. The follow-up plan clearly links back to the original premium-ABAC plan and the original feature/test IDs affected by the remediation.
