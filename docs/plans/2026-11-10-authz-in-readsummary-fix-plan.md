# Fix plan — authz in `readSummary`: whole-task redaction bypass

- **Card:** Security: authz in readSummary (`c2410fa9-1f03-5a87-bb71-d689a29aaaac`)
- **PSA ticket:** alga-2026-0003020
- **Source:** security review of PR #4004 (merge `4f3ca6d132bf`), finding `f2`, severity **high**
- **Fingerprint:** `packages/co-managed/src/sharedWorkRead.ts#readSummary`
- **Status:** finding **confirmed real**. No implementation exists on this branch yet; this is a forward-looking plan.

All line numbers below are against this branch (`feature/security-authz-in-readsummary`, HEAD `85d41c2779`, which is after the PR 4004 merge).

---

## 1. The defect

### Where it lives

`readSummary` is the one projection funnel for `getCoManagedSharedWorkSummary`:

- `packages/co-managed/src/sharedWorkRead.ts:151-154` — `readSummary` builds the summary as
  `visibleCoManagedFields(await readCoManagedSummaryCandidates(trx, resource), redactedFields)` and applies **no**
  whole-resource predicate.
- `packages/co-managed/src/sharedWorkRead.ts:157-162` — `getCoManagedSharedWorkSummary` routes a `project_task`
  resource (actor.tenant ≠ resource.tenant) through `withCoManagedSharedWork(... 'read', readSummary)`. The
  customer-ticket branch is `kind === 'ticket'` only, so **every** `project_task` read reaches `readSummary`.
- `server/src/lib/actions/coManagedSharedWorkActions.ts:15-20` — `getSharedWorkSummaryAction` is a `withAuth`
  server action that takes a **caller-supplied** `CoManagedSharedResource` and passes it straight into
  `getCoManagedSharedWorkSummary`. The resource `kind` union includes `project_task`
  (`packages/co-managed/src/sharedWork.ts:15`) and the action does not constrain it. A server action is directly
  invocable over the Next.js RPC endpoint by any authenticated caller, so the `kind` and `id` are attacker-chosen.

### The missing check

PR 4004 established that a reader whose effective redactions name the **whole task resource** may not read or write
the task at all. The predicate and its canonical aliases live in
`packages/co-managed/src/sharedWorkProjection.ts:6-11`:

```ts
export const CO_MANAGED_TASK_RESOURCE_ALIASES = ['tasks', 'project_tasks'] as const;
export const isCoManagedTaskResourceHidden = (redactedFields) => redactedFields.some(field =>
  field === '*' || field === 'fields' ||
  CO_MANAGED_TASK_RESOURCE_ALIASES.includes(field.startsWith('fields.') ? field.slice(7) : field));
```

The newer task paths enforce it as an opaque denial:

- `packages/co-managed/src/projectTaskAudit.ts:65` — task history throws `CoManagedSharedWorkError` when hidden.
- `packages/co-managed/src/projectTaskEditing.ts:89,122,170` — the task editor/apply paths throw likewise.

`readSummary` — a pre-existing generic reader — never got this guard. It relies entirely on the **per-field**
redaction in `visibleCoManagedFields` → `isCoManagedReadFieldHidden`
(`sharedWorkRead.ts:31-39`, `sharedWorkRedaction.ts:5-12`), which matches a redaction `R` against a candidate only
when, for some source/key name `N`: `R === N`, `R.startsWith(N + '.')`, or `N.startsWith(R + '.')`.

### Why the per-field match misses the whole-resource aliases

The `project_task` candidates are built at `sharedWorkRead.ts:137-148`. Their sources use `project_tasks.<field>`,
`project_id`/`projects`, `phase_id`/`project_phases`, and status-mapping aliases — but **never** the bare
whole-resource aliases `tasks` / `project_tasks`. Two concrete leaks follow:

- **Redaction `tasks` → total leak.** `path = 'tasks'` matches no candidate name (e.g. for `task_name`,
  names are `['task_name','project_tasks.task_name']`; `'tasks'` neither equals nor is a dotted prefix/suffix of
  either). `isCoManagedTaskResourceHidden(['tasks'])` is `true`, but `readSummary` returns the full summary:
  task name, WBS code, project, phase, status, `is_closed`, due date, created/updated timestamps
  (`sharedWorkRead.ts:138-147`).
- **Redaction `project_tasks` → partial leak.** `path = 'project_tasks'` catches the task-table candidates via
  `N.startsWith('project_tasks.')` (`task_name`, `wbs_code`, `due_date`, `created_at`, `updated_at`), but the
  `project` (`['project_id','project_name','projects']`), `phase` (`['phase_id','phase_name','project_phases']`),
  `status`, and `is_closed` candidates carry no `project_tasks.` source, so project and phase names/ids and the
  status still come back.

### Attack path

A sponsor-side co-managed user holding the `co-managed`/`serves` capability, assigned to a relationship that grants
`read` on a shared `project_task` but whose effective redactions (relationship `redacted_fields` ∪ home redactions,
merged at `sharedWork.ts:183`) include the whole-resource alias `tasks` (or `project_tasks` / `*`) — a configuration
whose explicit intent is "hide this task entirely" — calls `getSharedWorkSummaryAction({ tenant, relationshipId,
kind: 'project_task', id })`. The capability and the `withCoManagedSharedWork` matrix admit the read; `readSummary`
then returns the task metadata the redaction was meant to withhold. The task editor and history for the same task
correctly return an opaque 404, so this reader is a strictly weaker, inconsistent gate on the same resource.

---

## 2. The fix

### Single enforcement point

Add the whole-resource guard to `readSummary` — the one chokepoint every `project_task` summary read passes through
(both `getSharedWorkSummaryAction` and the internal callers in `ticketCollaboration.ts` and
`server/.../coManagedWorkActions.ts` funnel through `getCoManagedSharedWorkSummary` → `readSummary`):

- **File/function:** `packages/co-managed/src/sharedWorkRead.ts`, `readSummary` (currently lines 151-154).
- **Change:** before projecting, deny when the task resource is wholly hidden, matching the sibling readers exactly:

  ```ts
  async function readSummary(context: CoManagedSharedWorkContext): Promise<CoManagedSharedWorkSummary> {
    const { trx, resource, revision, redactedFields } = context;
    if (resource.kind === 'project_task' && isCoManagedTaskResourceHidden(redactedFields))
      throw new CoManagedSharedWorkError();
    return { resource, revision, fields: visibleCoManagedFields(await readCoManagedSummaryCandidates(trx, resource), redactedFields) };
  }
  ```

- **Import:** add `isCoManagedTaskResourceHidden` to the existing import from `./sharedWorkProjection`
  (`sharedWorkRead.ts` currently imports `isCoManagedReadFieldHidden` from `./sharedWorkRedaction`; the projection
  module is not yet imported here). `CoManagedSharedWorkError` is already imported (line 6-7), so the opaque 404 is
  the same error class the matrix uses (`sharedWorkRead.ts:156` — "A denial in ANY matrix layer is the same opaque
  error (404)").

### Why a throw, not candidate-source enrichment

The finding also suggests giving the task candidates `tasks.<field>` / `project_tasks.<field>` sources so
`visibleCoManagedFields` drops them per-field. That is **not** the right remedy here and the plan deliberately does
not do it:

- A per-field drop would return `{ fields: {} }` — a 200 that says "task exists, nothing to show" — whereas the
  siblings (`projectTaskAudit.ts:65`, `projectTaskEditing.ts:89`) return an opaque 404. Consistency across all task
  readers is the security property; the throw gives it.
- Reusing the existing `isCoManagedTaskResourceHidden` is the correct shared home: audit, editor, apply, and now the
  generic reader all enforce identical whole-resource semantics from one predicate + one alias list
  (`sharedWorkProjection.ts:6-11`). The class of bug — "a task reader forgot the whole-resource gate" — cannot recur
  silently, because there is exactly one predicate and new readers that skip it will diverge visibly from the three
  that use it.

### Why scope the guard to `project_task` and not generalize the throw to ticket/project

`readSummary` also serves `ticket` and `project`. Those do not need (and must not get) the same opaque throw:

- Every `ticket` candidate (`ticketSummaryCandidates`, `sharedWorkRead.ts:48-62`) and every `project` candidate
  (`sharedWorkRead.ts:111-120`) already carries a `tickets.<field>` / `projects.<field>` source, so a bare `tickets`
  or `projects` redaction is already caught per-field by `isCoManagedReadFieldHidden` and those fields are dropped.
  The gap is unique to `project_task`, whose project/phase candidates borrow sibling-table sources.
- For tickets, the work/handoff candidates (`ticketWorkCandidates`, `sharedWorkRead.ts:65-75`) are relationship
  state, not the ticket resource, and are intended to survive a `tickets` redaction. Forcing tickets through a
  whole-resource throw would regress that. So the guard is `kind === 'project_task'`, matching the only predicate
  (`isCoManagedTaskResourceHidden`) that exists.

---

## 3. The proof (tests)

### Primary — unit regression test (new)

`packages/co-managed/src/__tests__/sharedWorkReadRedaction.test.ts`, mirroring the mocking style of
`__tests__/projectTaskAudit.test.ts:1-26` (vitest + `vi.hoisted` state):

- Mock `../sharedWork` so `withCoManagedSharedWork(db, actor, resource, 'read', work)` invokes
  `work({ trx, resource, revision: 1, redactedFields: state.redactedFields })`. Use an actor whose `tenant` differs
  from the resource `tenant` so `getCoManagedSharedWorkSummary` takes the shared-work (not customer-ticket) branch
  (`sharedWorkRead.ts:159-161`).
- Provide a `trx` stub with `raw: () => ({})` and mock `@alga-psa/db` `tenantDb` to return a builder whose terminal
  `.first(...)` resolves a fake `project_task` row (task_name, wbs_code, project_id/name, phase_id/name, status, …)
  so the baseline read populates fields.

Assertions:

1. **Baseline (no redaction):** `getCoManagedSharedWorkSummary` for the `project_task` resource returns
   `fields.task_name` / `fields.project` populated. Guards that the fix does not over-deny normal reads.
2. **`it.each(['*','tasks','project_tasks'])` denial:** with that single redaction set, the call
   **rejects/throws**. This is the regression assertion.
   - *Fails before the fix:* `'tasks'` returns the full summary (no throw); `'project_tasks'` returns a partial
     summary with project/phase still present (no throw); `'*'` returns `{ fields: {} }` (no throw). None reject.
   - *Passes after the fix:* `isCoManagedTaskResourceHidden` is `true` for all three, so `readSummary` throws
     `CoManagedSharedWorkError` before the projection runs. (The throw short-circuits before any DB call, so the
     denial cases need no row mock.)
3. **Leak-specific assertions (optional, documentary):** before the guard, assert `'tasks'` leaks `task_name` and
   `'project_tasks'` leaks `fields.project`/`fields.phase`; convert these to "rejects" expectations once the fix
   lands. Keeps the two distinct leak shapes from §1 visible in the test record.

This test exercises that `readSummary` **wires** the guard; the predicate itself is already unit-tested in
`__tests__/sharedWorkProjection.test.ts:29-42`.

### Secondary — integration assertion (defense in depth, optional)

`ee/temporal-workflows/src/__tests__/integration/coManagedSharedWork.integration.test.ts` currently builds only
ticket worlds (`getCoManagedSharedWorkSummary` at lines 179/186/199/242/246/416). Adding a `project_task` world with
a relationship `redacted_fields` of `['project_tasks']` and asserting `denied(getCoManagedSharedWorkSummary(...))`
would prove it end-to-end through the real matrix and DB. This requires new world-builder scaffolding for a shared
task, so it is proposed as a follow-on, not a blocker; the unit test is the authoritative regression.

---

## 4. Scope not covered, and risks for the reviewer

**Deliberately out of scope:**

- No change to the `ticket` or `project` summary paths — already covered per-field; the ticket handoff fields are
  intentionally preserved under a `tickets` redaction (§2).
- No candidate-source enrichment of the task candidates — the throw supersedes it (§2).
- No change to `listCoManagedCustomerTickets` (`sharedWorkRead.ts:179-228`) — tickets only; it already passes
  `redactedFields` through `visibleCoManagedFields` and never projects tasks.
- No change to the `isCoManagedTaskResourceHidden` predicate or `CO_MANAGED_TASK_RESOURCE_ALIASES` — reused as-is.

**Risks / regressions to weigh:**

- **Behavior change:** readers with `tasks` / `project_tasks` / `*` in their effective redactions who previously
  received a (full or partial) task summary will now get an opaque 404. This is the intended security change and is
  consistent with the task editor/history, but a reviewer should confirm no UI surface relies on a partial task
  summary *under a whole-resource redaction* (none should — that redaction means "hide the task"). Normal readers
  (no whole-resource redaction, or only per-field redactions like `project_tasks.task_name`) are unaffected:
  `isCoManagedTaskResourceHidden` is `false` for nested paths (verified by
  `sharedWorkProjection.test.ts:37-42`).
- **Reachability caveat:** the exploit requires a relationship/home configuration that both grants `read` on the
  task and lists a whole-resource task alias in `redacted_fields`. If product config can never produce that pairing,
  the live exposure is latent rather than active — but the inconsistency with the editor/history gate is a real
  defect regardless, and the guard is the correct invariant to assert.
- **Entry-point audit:** the fix sits at `readSummary`, the shared chokepoint, so it holds for all three current
  callers of `getCoManagedSharedWorkSummary`. A reviewer adding a *new* project_task reader that bypasses
  `readSummary` must carry the same `isCoManagedTaskResourceHidden` guard — the single-predicate design makes that
  omission easy to spot in review.
