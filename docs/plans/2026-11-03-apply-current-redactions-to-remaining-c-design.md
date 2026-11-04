# Apply current redactions to co-managed snapshot reads

Card: `12257054-f672-479b-91d0-51328d932053`
PSA ticket: `alga-2026-0003072` (`5aa3f135-f0b3-4c28-9348-af1754b703c2`)
Branch: `feature/security-apply-current-redactions-to-remaining-c`
Follow-up: [PR #3988](https://github.com/Nine-Minds/alga-psa/pull/3988), from the security review of PR #3976.

## Problem and scope

Reference rows and audit records retain display names captured during assignment or editing. Their contents are historical facts, not permission to disclose those facts. Every response must apply the current reader's redactions, including when the customer tightens relationship redactions after a snapshot was written.

The reported reproduction showed the shared task detail for “Replace core switch (Cisco 9300)” displaying “Assigned to QA Tester” and “Assignee set to QA Tester” under an `assignee_name` redaction. This is historical review evidence at PR #3988 head `9c41e0de81`, not a live result from this checkout.

This change covers task detail snapshots, edit-conflict snapshots, shared project task lists, assigned-task queues, task history changes and actor attribution, and ticket reference-derived response fields. Ticket assignment and detail readers must be checked against the same policy sources.

## Code inventory

The line numbers below refer to committed baseline `4f3ca6d132bfd9283c60c13c2206ca75d69fc391`. Existing uncommitted work in this checkout already attempts some migrations; it is not the baseline or proof of completion.

All paths in this table are relative to `packages/co-managed/src/`.

| Surface | File:line and symbol | Baseline behavior and remaining work |
| --- | --- | --- |
| Task detail snapshot | `projectTaskEditing.ts:23`, `:87`, `:108` (`assigneeOf`, `getCoManagedProjectTaskSnapshot`, `referenceRow`) | `assigneeOf` already calls `maskCoManagedSnapshot` with current redactions in this baseline. The raw reference accessor still returns the entire row, so masking remains optional for callers. Route display reads through a projected accessor and preserve nullable assignee names. |
| Edit-conflict snapshot | `projectTaskEditing.ts:129` (`fresh` inside `editCoManagedProjectTask`) | Already uses the same assignee mask, but receives a raw reference row. Use the same projected accessor as initial loading for both revision and customer-drift conflicts. Preserve reference locking and guard tokens. |
| Shared project task list | `projectTaskQueue.ts:112`, `:121` (`listCoManagedSharedProjectTasks`) | Reads reference snapshots directly and returns `reference.assignee_name` without masking. This is an outstanding direct name leak. |
| Assigned-task queue | `projectTaskQueue.ts:157`, `:164` (`listCoManagedAssignedTasks`) | Already masks four names inside admission, but fetches raw display snapshots during discovery. Make discovery identity-only and read projected snapshots inside each admitted callback. Preserve pagination and rows with hidden names. |
| History change payloads | `projectTaskAudit.ts:71`, `sharedWorkProjection.ts:61` (`listCoManagedProjectTaskHistory`, `CO_MANAGED_AUDIT_DERIVED_ALIASES`) | Baseline already filters through `projectCoManagedChanges` and maps `msp_assignee` to assignee source aliases. Keep that protection, complete alias coverage, and regress the public history reader. Never return stored principal IDs. |
| History actor attribution | `projectTaskAudit.ts:75` | Emits `details.actor_display_name` and `details.actor_organization_name` directly. Both require independent current-policy projection. This is an outstanding direct name leak. |
| Ticket queue and export | `ticketQueue.ts:88`, `:150`, `:165`, `:191`, `:206` (`sources`, `readCoManagedTicketQueue`) | The reference join does not return cached names. It derives `has_msp_assignment`, working membership and signals from reference principals. Its aliases omit `assignee_name`, `users`, `teams` and organization sources that hide the assignment detail. Close that policy inconsistency in the SQL projection and all dependent membership, signal and count paths. Export uses the same reader. |
| Ticket assignment detail | `ticketAssignments.ts:18`, `:35`, `:51`, `:68` (`hidden`, `retainedRouting`, `state`, `getCoManagedTicketAssignment`) | Reference reads supply routing and principal IDs, not cached names. Names are resolved by `sharedWorkAssignees.ts:43`. `state` checks current redactions first, including assignee and organization aliases; nested read/update admission combines both policies. Retain those protections and share the source definitions with the queue. |
| Shared ticket details | `sharedTicketDetails.ts:26`, `:37`, `:59`, `:72` (`sources`, `readDetails`) | Reads live customer rows, not reference snapshots. Fields are omitted using current callback redactions. Customer-assignee aliases include `assignee`, `assigned_to` and `users`, but omit `assignee_name`; align applicable display-name aliases and verify the live-name fallback cannot bypass a hidden source. |

The baseline organization alias list in `sharedWorkProjection.ts:14` lacks `organization_name` and `values.organization_name`. Central aliases must cover stored column names as well as public response names. Fixing a caller while retaining incomplete aliases would leave the same disclosure under a different policy spelling.

## Projection contract

### Current policy is the input

`withCoManagedSharedWork` constructs callback `redactedFields` from home read-policy redactions and current relationship `redacted_fields` (`sharedWork.ts:183`). Readers must use that callback context. Assignment-time filtering, a discovery query, an earlier page load or the writer's permissions cannot substitute for current reader policy.

`maskCoManagedSnapshot(redactedFields, row, spec)` remains the common value-projection primitive. It copies the row, sets mapped hidden fields to `null`, and leaves other fields unchanged. `isCoManagedReadFieldHidden` recognizes wildcard redactions, `fields.` prefixes and parent/child paths. Do not create a second matcher.

Central source definitions must associate each emitted display field with its canonical column, public alias, `values` path, applicable resource-qualified paths and underlying source collections. Assignee names depend on `assignee_name`, `assignee`, `users` and `teams`. Organization names depend on `organization_name`, `client_name` and `tenants`. Actor names and actor organization names need their own output aliases plus their corresponding user and organization sources. A hidden source hides a derived value; no fallback may reconstruct it from another column.

### Reference readers return projected data

Introduce a task-reference accessor taking the admitted `CoManagedSharedWorkContext` and the task identities being read. It must:

1. Qualify reads by sponsor tenant, customer tenant, relationship, active state and task identity. For project-list reads, obtain task identities from the admitted project's task query. A task-detail read must stay bound to the admitted task.
2. Select only required columns and project every cached display name before returning. Raw snapshot rows remain private to the accessor. Return an explicit typed object; do not spread a database row into a public payload.
3. Expose necessary revision/reference tokens and permitted derived assignment state separately from raw principals. Treat any derived field as policy-bearing when its source is hidden; an internal routing fact must not silently become a public disclosure.
4. Support command-side reference locking without weakening the existing transaction or concurrency guards. A command may use internal routing identifiers without returning raw snapshot data.
5. Serve the detail loader, both conflict snapshots, shared task list and assigned-task queue through this one path. Discovery may return qualified identities and pagination cursors, never display snapshots for later serialization.

An accessor returning a masked view creates a package-level boundary: callers cannot accidentally serialize the raw row they were handed. TypeScript alone does not stop future direct SQL, so keep raw row types private and verify the inventory during review. The existing untracked `projectTaskReference.ts` is a candidate implementation, not an accepted contract; check admission scope and derived fields before adopting it.

### History is a projected response

Build history entries through a common history projection that applies the callback's redactions to both changes and attribution. `projectCoManagedChanges` must use the derived-field dependency registry: hiding an assignee source omits the entire `msp_assignee` change, including nested names and IDs. Hidden changes are omitted, not changed to `null`, because null can mean an actual removal.

Project actor display and organization names independently through `maskCoManagedSnapshot`. Preserve the current string response contract with empty strings for hidden attribution, or update the response type and all consumers together if nullable names are chosen. Never substitute a UUID, email or retained name when a source is hidden. Keep event identity, timestamp and operation when individual fields are hidden; whole-resource redactions continue to deny the history read.

### Ticket SQL uses the same field dependencies

The ticket queue is a federated SQL reader with its own session, lifecycle, relationship and bundle-policy admission. Preserve that admission and its authorized relation; moving pagination or counts into per-row callbacks would change semantics.

Share assignment source aliases between ticket assignment detail and queue projection. Apply current home and applicable relationship redactions before reference-derived values leave the relation. Where relationship policy differs by owner, compute visibility per relationship projection. Express hidden assignment presence as SQL `NULL`, disable signals that depend on it, and remove its contribution to working membership. Use those same expressions for page reads, export, signal filters and counts. Raw reference columns may remain internal policy inputs; they must not escape in output.

Ticket assignment and shared detail readers resolve names live. They still need the same dependency checks before returning those names. No new cached-name field or ticket-reference display schema is required.

## Verification required with implementation

Use behavioral tests that invoke readers and inspect their returned values or errors. Helper tests supplement reader tests; source-string assertions do not establish protection.

| Reader or behavior | Required regression |
| --- | --- |
| Task detail | Load a reference containing `QA Tester`; apply each assignee alias and verify no name is returned. Verify an unredacted reader still sees the name. |
| Conflict snapshots | Trigger revision and customer-drift conflicts and inspect their attached fresh snapshots under the same redactions. Verify no write occurs. |
| Shared task list | Return a task with a cached assignee; verify the name is null under redaction and pagination, revision and task visibility remain correct. |
| Assigned-task queue | Retain existing current-policy tests and exercise the projected accessor, all cached display fields and revoked admission. Hidden names must not remove otherwise authorized assigned work. |
| History | Seed a stored assignment name and actor names. Verify assignee-source redactions omit the whole change; actor and organization redactions independently mask attribution; unrelated visible changes remain and principal IDs never appear. |
| Ticket queue and export | Exercise assignment presence, working/oversight membership, both signals and counts under assignee and organization aliases. Check export and page reads agree. Include distinct relationships with different redactions. |
| Ticket assignment and shared detail | Verify their public readers suppress names under applicable aliases, including `assignee_name`; preserve existing read/update policy union and customer-side principal protection. |

For every affected surface, cover both policy origins: a redaction already in the reader's bundle and a customer relationship tightened after assignment. For the latter, retain the exact stored reference/audit names, read once with permission, change relationship policy, then read again and assert the previously visible values disappear. Rewriting the snapshots while changing policy would not test this defect. Include user and team assignments, organization aliases, wildcard/parent paths, empty names and an unredacted control.

Run the relevant co-managed behavioral suites and type checks after migration. Document actual results separately from this design.

For live C2 validation, assign “Replace core switch (Cisco 9300)” to QA Tester, retain its history, then enable the customer's `assignee_name` redaction. Reload the shared detail as the affected MSP reader. The detail must show no assignee name and history must contain no “Assignee set to QA Tester” text. Inspect the response payload as well as rendered text. Record the environment, revision and browser evidence. This document does not claim that live check has passed.

## Deliberate exclusions

- No schema migration, snapshot backfill, destructive audit rewrite or assignment-time erasure. Historical storage remains intact; authorization governs each read.
- No changes to grant semantics, lifecycle admission, RBAC, eligibility, command replay, task editing authority or concurrency behavior.
- No redesign of queues, working/oversight features, ticket routing, assignment pickers or UI beyond supporting the existing hidden-value response contract.
- No blanket migration of conversation, participation-evidence or historical-evidence systems. Their retention/write paths are separate from the readers above. Any additional public snapshot reader discovered during implementation must be recorded and assessed before declaring the inventory complete.
- No implementation changes, production configuration changes or live acceptance claims in this prerequisite document commit.

## Layering decision

The existing `co-managed-alias-lists` marker in `sharedWorkProjection.ts` and `projectTaskAssignments.ts` records repeated dependency definitions. The task detail, task list and assigned-task queue repeat the same reference-to-display transformation, with a demonstrated disclosure when one omits masking. Frequency, security cost, stable snapshot structure and reuse justify a shared projected accessor and shared alias definitions. The bounded implementation will migrate these readers together and verify behavior at their public boundaries. A general query framework or new policy engine would add no necessary capability here.
