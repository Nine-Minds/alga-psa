# listCoManagedSharedProjectTasks — mask the assignee name like every sibling reader

Card: `e6ed3640-0eb8-5b1d-9770-58f89e5943af`
Finding: **authz · high** — `packages/co-managed/src/projectTaskQueue.ts:119`
(`listCoManagedSharedProjectTasks`), reviewed on merge `1709830ce6d3` (PR #3988).

## What is wrong (confirmed on the branch)

A shared-project task list is readable by any technician whose relationship admits the project, and the
reader receives the policy's `context.redactedFields` at `projectTaskQueue.ts:101`. The function honours
them for the two fields it already masks — it drops the whole page when `task_name` is hidden
(`:107`) and nulls `due_date` when `due_date` is hidden (`:116`) — but it selects `assignee_name`
(`:110-112`) and returns it unconditionally in the reference object (`:116-120`):

```ts
reference: reference ? { revision: reference.revision, assigneeName: reference.assignee_name, assignedToMe: reference.assigned_to === actor.userId } : null
```

`listCoManagedSharedProjectTasksAction` (`server/src/lib/actions/coManagedProjectTaskActions.ts:57-63`)
returns that page as-is and the client prints the value directly
(`server/src/components/co-managed/CoManagedProjectTasks.tsx:56-57`). So a reader whose effective policy
hides `assignee_name`, `assignee`, `users` or `teams` still learns **who** every task on the shared project
is assigned to — the sibling defect pattern this PR family already fixed in three other readers, missed here.

Two siblings in the same package already do it correctly and are the model:

- `listCoManagedAssignedTasks` (`projectTaskQueue.ts:169`) masks its row through
  `maskCoManagedSnapshot(…)` with `CO_MANAGED_ASSIGNEE_NAME_ALIASES`;
- `projectTaskEditing.ts:26` masks a single reference the same way, guarding on a present name.

## Design

### Rule

**The assignee's display name is a redactable field everywhere it is returned.** When the reader has it
hidden, the name is `null`; the *assignment fact* survives (that is not a name), so the row still reads as
assigned and still says whether it is assigned to the reader. Nothing else about the page changes — in
particular the existing `task_name`-hides-the-page behaviour stays, because a task with no name cannot be
listed at all.

This keeps the shared-projection module the single place that maps field → aliases
(`sharedWorkProjection.ts:16`); the reader gets no new alias list and no local copy of the masking rule.

### 1. Project the reference through the existing masker

In `listCoManagedSharedProjectTasks` (`projectTaskQueue.ts:116-120`), build the reference and pass it
through `maskCoManagedSnapshot` with only the name in the spec, so `revision` and `assignedToMe` keep their
types and values:

```ts
const reference = byTask.get(task.task_id);
return { …, reference: reference ? maskCoManagedSnapshot(context.redactedFields, {
  revision: reference.revision,
  assigneeName: reference.assignee_name ?? null,
  assignedToMe: reference.assigned_to === actor.userId,
}, { assigneeName: CO_MANAGED_ASSIGNEE_NAME_ALIASES }) : null };
```

`maskCoManagedSnapshot` nulls only spec'd fields and refuses to infer from a sibling column, which is exactly
the guarantee the finding asks for (`sharedWorkProjection.ts:80-96`). `CO_MANAGED_ASSIGNEE_NAME_ALIASES` is
already imported in this file (`:7`).

### 2. Make the type say so

`CoManagedSharedTaskRow.reference.assigneeName` becomes `string | null` (`projectTaskQueue.ts:91-94`), the
same shape `CoManagedAssignedTaskRow.assigneeName` already uses (`:127`). A nullable type is the compile-
time half of the fix: any future reader that concatenates or sorts by the name has to handle `null`.

### 3. Client: three states, not two

`CoManagedProjectTasks.tsx:56-57` currently renders `reference ? reference.assigneeName || '—' : notAssigned`.
With a hidden name that would print `—` inside "Assigned to" — which reads as *unassigned* and is a new lie.
Render:

- `reference === null` → existing `coManaged.sharedTasks.unassigned` ("Not assigned");
- `reference.assigneeName === null` → new `coManaged.sharedTasks.assigneeHidden` ("Assigned") when
  `assignedToMe` is false, and the existing "Assigned to you" phrasing when it is true — the flag is
  explicitly non-sensitive and the finding says to preserve it;
- otherwise → the name.

No localisation keys beyond the two defaults above; the strings go through `t()` like the rest of the file.

### 4. Regression test that fails without the fix

New `packages/co-managed/src/__tests__/sharedProjectTaskQueue.test.ts`, closely modelled on
`assignedTaskQueue.test.ts` (it stubs `withCoManagedSharedWork` through `vi.hoisted` state and drives
`redactedFields` per case). Cases:

1. `redactedFields = []` → names returned unchanged, `assignedToMe` correct for the acting user.
2. `redactedFields = ['assignee_name']` → `assigneeName === null`, `revision` and `assignedToMe` intact,
   row **not** dropped, and `taskName`/`dueDate` untouched.
3. Each sibling alias (`'assignee'`, `'users'`, `'teams'`, `'values.assignee_name'`) hides the name — the
   same loop the ticket-assignment surface uses, so an alias added later cannot silently reopen the field.
4. `redactedFields = ['task_name']` still yields `{ rows: [], nextAfterTaskId: null }` — the deliberate
   page-drop is pinned, not accidentally relaxed.
5. An unassigned task (`reference === null`) is unaffected by an assignee redaction.

Assertion 2 is the one that fails on `main`: with no masking the name is returned in full.

## Order of work

1. Type + masker in `projectTaskQueue.ts` (compile break surfaces any other consumer of the reference).
2. Client three-state render.
3. The test file; run `npx vitest run packages/co-managed/src/__tests__/sharedProjectTaskQueue.test.ts`
   plus the neighbouring `assignedTaskQueue` and `projectTaskAudit` suites.
4. Update the "two deliberate behaviours" doc comment above `maskCoManagedSnapshot`
   (`sharedWorkProjection.ts:84-89`) to state that the shared-project task list now nulls the reference
   name while still dropping the page on a hidden task name.

## Not doing (deliberately)

- **Not** changing which rows the list returns, and **not** turning a hidden `task_name` into a nulled
  column: the current drop-the-page rule is a considered one, documented in the masker.
- **Not** touching `listCoManagedAssignedTasks` or the editing path — both already mask.
- **Not** adding a new alias constant or a per-module redaction check: the finding is a missing use of the
  existing mechanism, and a second mechanism is how this defect recurs.
- **Not** widening what the client may show when the name is hidden: it gets the boolean fact, never a
  derived hint (initials, "a colleague", team id).

## Risks

- An external/EE consumer may today compare `reference.assigneeName` to a string; the nullable type turns
  those into compile errors rather than silent nulls — the intent. Only `server/src/components/co-managed/
  CoManagedProjectTasks.tsx` and the co-managed server action consume this row today.
- `maskCoManagedSnapshot` is already the engine for this exact decision, so policy drift between the
  assigned queue and this one disappears rather than being duplicated.
