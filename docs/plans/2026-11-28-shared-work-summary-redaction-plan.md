# Fix plan — Security: authz in readSummary (generic shared-work summaries bypass whole-task resource redactions)

- **Card:** Security: authz in readSummary (`c2410fa9-1f03-5a87-bb71-d689a29aaaac`)
- **Source finding:** security review of PR #4004, merge `4f3ca6d132bf`, review card `1e5a2ffc-8cd1-52e4-940c-9c177c7e3662`
- **Fingerprint:** `packages/co-managed/src/sharedWorkRead.ts#readSummary`
- **Verdict:** **Confirmed real.** No fix exists on this branch. Prior art PR #4255 (guard + tests) exists on a stale base; treat as evidence, not as a patch to copy — this branch is off current main.

---

## 1. The defect

### What is missing
`readSummary` projects a summary through `visibleCoManagedFields` only — a **per-field**
redaction matcher — and never applies the **whole-task resource** predicate that every sibling task
read/write path enforces.

- `packages/co-managed/src/sharedWorkRead.ts:160-163` — `readSummary` returns
  `visibleCoManagedFields(await readCoManagedSummaryCandidates(trx, resource), redactedFields)`.
  No whole-resource check.
- `packages/co-managed/src/sharedWorkRead.ts:166-171` — `getCoManagedSharedWorkSummary` dispatches
  `ticket` to `withCoManagedCustomerTicket` and everything else (`project`, `project_task`) to
  `withCoManagedSharedWork`, both with `readSummary`.
- `server/src/lib/actions/coManagedSharedWorkActions.ts:16-21` — `getSharedWorkSummaryAction` accepts a
  caller-supplied `CoManagedSharedResource` and calls `getCoManagedSharedWorkSummary` directly.
- `server/src/lib/actions/coManagedWorkActions.ts:29` and
  `packages/co-managed/src/ticketCollaboration.ts:42,139` — other callers of the same reader.

The sibling paths all gate on the canonical predicate
`isCoManagedTaskResourceHidden` (`packages/co-managed/src/sharedWorkProjection.ts:14-17`):

- `projectTaskEditing.ts:90,123,171` — snapshot, edit, and status-option reads all `throw new CoManagedSharedWorkError()`.
- `projectTaskAudit.ts:57` — task history read.
- `projectScreenRead.ts:167` — `locateCoManagedSharedTask`.
- `projectTaskConversation.ts:80,147,196` — conversation read/write/list.

### Why the summary path is different
For a `project_task`, `readCoManagedSummaryCandidates` (`sharedWorkRead.ts:131-157`) sources each
candidate via `coManagedEditFieldPaths(field)` (`sharedWorkProjection.ts:24-27`), which yields
`[field, values.field, tasks.field, project_tasks.field, …derived]` — plus two candidates that carry
**no task alias at all**:

- `project` — sources `['project_id', 'project_name', 'projects']` (`sharedWorkRead.ts:149`)
- `phase` — sources `['phase_id', 'phase_name', 'project_phases']` (`sharedWorkRead.ts:150`)

`isReadFieldHidden` (`packages/authorization/src/recordProjection.ts:20-44`) matches a whole-table
redaction against dotted sources (`tasks` overlaps `tasks.task_name`), so a per-field read hides the
task columns but **never** the `project`/`phase` candidates, and never turns the read into a denial.

### Concrete leak shapes (each returns data where siblings return 404)
1. **`tasks` / `fields.tasks`** — hides `task_name`, `wbs_code`, `status`, `is_closed`, `due_date`,
   `created_at`, `updated_at` (all carry `tasks.<field>`), but `project` and `phase` **still return**
   project id/name and phase id/name.
2. **`project_tasks` / `fields.project_tasks`** — same: task columns hidden, `project` + `phase` leak.
3. **`*` / `fields`** — `visibleCoManagedFields` hides every field, but `readSummary` still returns
   `{ resource, revision, fields: {} }`, disclosing the admitted resource identity and its `revision`
   where siblings return the opaque 404.

This is a whole-resource denial semantics gap, not a per-field matcher bug: the sibling guard exists
precisely because "a reader who has hidden the task resource may not read the task at all"
(`sharedWorkProjection.ts:11-12`).

---

## 2. The fix (the general mechanism, not a one-call patch)

Reuse the **same** whole-resource predicate the siblings already enforce, at the **single**
caller-facing projection boundary. Fail closed (opaque `CoManagedSharedWorkError`, i.e. the 404
parity the sibling paths use).

### Decisions, with reasoning

**D1 — Reuse `isCoManagedTaskResourceHidden`, do not introduce a parallel rule.**
The guard is the exact predicate `projectTaskEditing.ts`, `projectTaskAudit.ts`, `projectScreenRead.ts`
and `projectTaskConversation.ts` already call. Adding a second, summary-specific spelling of
"whole-task redaction" is how these paths drift again. Import it into `sharedWorkRead.ts` from
`./sharedWorkProjection` (where `coManagedEditFieldPaths` is already imported).

**D2 — Put the guard in `readSummary`, not in `readCoManagedSummaryCandidates`.**
`readCoManagedSummaryCandidates` is exported and consumed by two system evidence paths that have **no
caller redactions** and must stay unaffected:

- `packages/co-managed/src/historicalWorkEvidence.ts:47`
- `packages/co-managed/src/workSnapshotEvidence.ts:31`

Those paths project raw candidates for archival evidence under a system context, not for a caller.
`readSummary` is the one place that (a) has `redactedFields` in scope and (b) is the funnel for every
caller-facing summary read (both server actions and `ticketCollaboration.ts`). Guarding there covers
all entry points with one change.

**D3 — Scope the guard to `resource.kind === 'project_task'`.**
- `ticket` candidates all carry `tickets.<field>` sources and are read under the ticket-specific
  admission; there is no whole-ticket-resource predicate in use anywhere, and this finding does not
  claim one.
- `project` candidates all carry `projects.<field>` sources; the project screen already drops a whole
  project via a name-alias guard (`projectScreenRead.ts:74`), not a whole-resource predicate. A
  whole-`projects` denial for the summary is a **separate, pre-existing gap** (see §4), out of scope.
The finding is a `project_task` finding; widening to ticket/project would invent semantics the
siblings do not have and is explicitly out of scope.

**D4 — The resource type is already constrained server-side; no derivation is needed.**
`withCoManagedSharedWork` (`sharedWork.ts:159-161`) rejects any `resource.kind` outside
`['ticket','project','project_task']` and rejects non-UUID `tenant`/`relationshipId`/`id`, throwing
`CoManagedSharedWorkError` (opaque 404) before any DB statement. The caller therefore cannot spoof an
arbitrary kind or an unknown resource: an unknown/unsupported resource already fails closed. The
guard is a read-side redaction addition, not a replacement for that admission.

**D5 — Deny with `CoManagedSharedWorkError`, matching sibling parity.**
Returning an empty summary (rather than throwing) would still disclose the resource identity and
`revision` (leak shape 3) and diverge from `projectTaskEditing.ts`/`projectTaskAudit.ts`, which throw.

### Exact edits

1. `packages/co-managed/src/sharedWorkRead.ts`
   - Extend the existing import from `./sharedWorkProjection` (line 5) to also import
     `isCoManagedTaskResourceHidden`.
   - In `readSummary` (line 160-163), before reading/projecting, add:
     ```ts
     if (resource.kind === 'project_task' && isCoManagedTaskResourceHidden(redactedFields)) throw new CoManagedSharedWorkError();
     ```
     `CoManagedSharedWorkError` is already imported (line 7).

No other product code changes. No signature changes; no new exports.

### Order of work
1. Apply the guard in `readSummary`.
2. Write the library regression test (§3 primary) and run it — assert it fails without the guard and
   passes with it.
3. Write the action-level test (§3 secondary).
4. Typecheck: `cd packages/co-managed && npm run typecheck` (guard), then
   `cd server && NODE_OPTIONS=--max-old-space-size=12288 npx tsc --noEmit -p tsconfig.json` (the action
   test and any new import in server test code).

---

## 3. The proof

### Primary — library regression test (must fail without the fix)
New file: `packages/co-managed/src/__tests__/sharedWorkReadRedaction.test.ts`, modeled on the existing
`server/src/test/unit/coManaged/taskFieldRedaction.test.ts` mocking pattern: `vi.mock('@alga-psa/db')`
with `fakeTenantDb`/`withTransaction`, and `vi.mock('@alga-psa/co-managed/sharedWork')` so
`withCoManagedSharedWork`/`withCoManagedCustomerTicket` invoke the command with a controllable
`redactedFields`. Import `getCoManagedSharedWorkSummary` and `CoManagedSharedWorkError` directly (the
unit under test is the **real** `readSummary`).

Seed a `project_task` row (plus `project_phases`/`projects`/`project_status_mappings`/`statuses` rows
the projection joins) in the fake store.

Denial cases — `getCoManagedSharedWorkSummary(db, actor, { kind: 'project_task', … })` **rejects**
with `CoManagedSharedWorkError` for each of `'*'`, `'fields'`, `'tasks'`, `'project_tasks'`,
`'fields.tasks'`, `'fields.project_tasks'`. Assert the rejection, and (where observable through the
mock) that no candidate was shaped — the leak is proven by the throw itself, since today these cases
**return** a summary (with `project`/`phase` populated for `tasks`/`project_tasks`).

Allow controls — the same call **resolves** and returns readable fields for:
- no redaction (`[]`) — full summary present (task_name, wbs_code, project, phase, status, dates);
- a nested per-field redaction (`'tasks.due_date'`) — summary present minus `due_date`, proving the
  guard is scoped to whole-resource and does not fire on field-level redactions;
- an unrelated field (`'tasks.description'`) — summary unchanged.

This pins the redaction semantics identical to `taskFieldRedaction.test.ts:119-124` (whole-task
denial) but for the summary path.

### Secondary — server action-level test (caller-supplied resource + unknown resource)
New file: `server/src/test/unit/coManaged/sharedWorkSummaryAction.authz.test.ts`, mocking the process
boundary in the house style (`@alga-psa/auth` `withAuth`, `@alga-psa/core/capability/server`
`requireCapabilityForAction`, `@alga-psa/db` `createTenantKnex`, and `browserActor`), so
`getSharedWorkSummaryAction` is exercised with a real imported `getCoManagedSharedWorkSummary`:

- **Caller-supplied-resource path (co-managed seat user):** an actor whose tenant passes
  `requireCapabilityForAction('co-managed', tenant, 'serves')` (the seat/capability gate) submits
  `{ kind: 'project_task', … }`. Assert the action **throws the propagated `CoManagedSharedWorkError`**
  when the underlying summary redacts the whole task, and returns the readable summary when not
  redacted.
- **Unknown/unsupported resource:** submitting an unsupported `kind` is rejected (via
  `withCoManagedSharedWork`) without reaching the summary projection — proving the server already
  fails closed for unknown resources and the fix does not need to add kind derivation.

### Live-seat integration follow-on (optional, not required for acceptance)
The existing `ee/temporal-workflows/src/__tests__/integration/coManagedSharedWork.integration.test.ts`
drives `getCoManagedSharedWorkSummary` over a real DB and policy. If the XO wants DB-backed proof of
the seat case, add one case there asserting a whole-task-redacted relationship returns the denial; it
is a follow-on because it needs a redacted-policy fixture that the unit mocks already cover.

### Why the tests fail before the fix
Today `readSummary` never throws for `tasks`/`project_tasks`/`*`, so the denial assertions (rejects
with `CoManagedSharedWorkError`) fail — the call resolves and returns `project`/`phase` (or an empty
`fields` for `*`). After the guard, the throw lands exactly as it does in the sibling paths.

---

## 4. Scope not covered, and reviewer risks

**Deliberately not doing:**
- **Whole-`projects` resource denial for the `project` summary.** `project` candidates carry only
  `projects.<field>` sources, so a `projects` redaction yields an empty `fields` summary rather than a
  404. This is a pre-existing gap with no sibling whole-resource predicate for projects (the project
  screen drops on name-alias only, `projectScreenRead.ts:74`), and it is **not** this finding's
  fingerprint. Flagged here so it is not mistaken for "closed by this card."
- **Whole-`tickets` resource denial for the `ticket` summary.** Same shape; the ticket reader has no
  whole-resource predicate anywhere in the codebase. Out of scope.
- **Deriving the resource kind server-side.** Already impossible to spoof (`sharedWork.ts:159-161`);
  adding derivation would be redundant and is not required to close this finding.
- **Consolidating the duplicated whole-task guard calls** into one shared admission wrapper. The four
  sibling paths each call `isCoManagedTaskResourceHidden` inline; a single `assertTaskResourceVisible`
  helper would remove the copy, but that is a refactor beyond this card and is noted as a
  `// LEVERAGE: friction` candidate, not executed.

**Risks a reviewer should weigh:**
- **Tightening is a behavior change by design.** Any caller that currently receives a wider
  `project_task` summary under a whole-task redaction will now get the opaque 404. That is the
  intended correction, but it is observable; if a real relationship redacts the whole task for a
  co-managed seat, its summary read (and any surface built on it, e.g. a task link resolving through
  the summary) will fail the moment this ships.
- **Evidence-path isolation.** `historicalWorkEvidence.ts` and `workSnapshotEvidence.ts` call
  `readCoManagedSummaryCandidates` directly and are intentionally left untouched. The implementer must
  confirm the guard is in `readSummary` (not the candidate reader) so archival evidence keeps working.
- **Mock fidelity in the library test.** The fake `withCoManagedSharedWork` injects `redactedFields`
  directly; the guard depends only on `redactedFields` and `resource.kind`, both present in the mocked
  context, so the test exercises the real predicate and throw — but it does not exercise the L2
  admission that produces those redactions. The action test and (optionally) the integration follow-on
  close that gap.
