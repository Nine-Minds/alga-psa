# Fix plan — Project/task mutations enforce only *read* record scope

- **Card:** Security: authz in assertProjectReadAllowed (8652c449-0e83-5fab-ae9a-c677213ed4fb)
- **Finding:** authz · high — `packages/projects/src/actions/projectActions.ts#assertProjectReadAllowed`
- **Source review:** PR 3987, merge `e75baf12b57c`
- **Branch:** `feature/security-authz-in-assertprojectreadallowed` (HEAD = merge commit; no fix implemented yet)
- **Verdict:** Finding is **real**. The exact mechanism is confirmed, and the exploitable surface is *wider* than the finding states (deletes, staging, and status-mapping mutations are affected too). The fix below is **more correct than the finding's suggested "pass update everywhere"** — see §2.4.

---

## 1. The defect, precisely

### 1.1 Two independent gates, only one of which is record-aware

Every project/task mutation runs two authorization checks:

1. A **coarse, tenant-wide RBAC** check — e.g. `checkPermission(user, 'project', 'update', knex)` in `updateProject` (`packages/projects/src/actions/projectActions.ts:1686`). This asks "may this user update projects *at all* in this tenant?" It says nothing about *this* project.
2. A **record-level** check — `assertProjectReadAllowed(...)` / `assertProjectReadAllowedById(...)` — which runs the authorization kernel against the specific project row so that **bundle narrowing** (own/assigned/team/selected-clients/etc.) can restrict the user to a subset of the tenant's projects.

The record-level check is the one that enforces bundle narrowing. **The bug is that the record-level check is hard-wired to the `read` action on every mutation path**, so it only ever consults `project:read` narrowing rules and never the `project:update` / `project:delete` rules that are supposed to gate the write.

### 1.2 Why `read` scope is the wrong scope — the kernel is action-specific

Bundle narrowing rules are matched on **both resource type and action**:

```
// packages/authorization/src/kernel/providers/bundleProvider.ts:75-77
const matchingRules = rules.filter(
  (rule) => rule.resource === input.resource.type && rule.action === input.resource.action
);
```

`project` is a resource with four distinct, independently-grantable actions — `create`, `read`, `update`, `delete` (`server/migrations/utils/permissions/catalog.cjs:219-226`), and bundle rules are stored per-action (`authorization_bundle_rules.action`, resolved verbatim at `packages/authorization/src/bundles/service.ts:986-994`). So a narrowing rule authored against `project:update` is **only** consulted when the kernel is called with `resource.action === 'update'`. When `matchingRules` is empty the provider returns `ALLOW_ALL_SCOPE` (`bundleProvider.ts:79-86`), and the kernel's decision is `allowed: builtinResult.allowed && !scope.denied` (`engine.ts:86`) → **allow**.

The record authorizer threads its action straight into that filter:

```
// packages/projects/src/lib/projectReadAuthorization.ts:102-139
export async function createProjectReadAuthorizer(
  conn, tenant, user,
  action: 'read' | 'update' = 'read',   // <-- plumbing exists…
) { ...
    resource: { type: 'project', action, id: projectId },   // line 132
```

The `action` parameter and the `resource.action` plumbing already exist (this is what PR 3987 added — "the PR's new action-aware authorizer exposed the existing mismatch"), **but no caller ever passes anything but the `read` default.** Grep for `createProjectReadAuthorizer(` / `assertProjectReadAllowed(` / `assertProjectReadAllowedById(` across `packages/projects/src` returns ~80 call sites, every one of them read-scoped.

### 1.3 The three record-level helpers, all read-only

- `packages/projects/src/lib/projectReadAuthorization.ts:146-163` — exported `assertProjectReadAllowed` → `createProjectReadAuthorizer(conn, tenant, user)` (default `read`). Used by staging, import, export.
- `packages/projects/src/actions/projectActions.ts:325-342` — local `assertProjectReadAllowed` → `createProjectReadAuthorizer(trx, tenant, user)` (default `read`), line 336.
- `packages/projects/src/actions/projectTaskActions.ts:504-519` — local `assertProjectReadAllowedById` → `createProjectReadAuthorizer(trx, tenant, user)` (default `read`), line 515.
- `packages/projects/src/actions/projectTaskStatusActions.ts:300` — a fourth local `assertProjectReadAllowed`, same pattern.

### 1.4 Concrete attacker paths

Pre-conditions: attacker is an internal user who **holds coarse `project:update` (and/or `project:delete`)** — e.g. a Project Manager — but is assigned a bundle whose `project:update` rule narrows them to their own/assigned projects (e.g. template `own_or_assigned`). They can *read* project A broadly (the read rule is wider, or they legitimately see A in a list), but they must **not be able to write A**.

- **Update a forbidden project.** `updateProject(A, data)` → coarse `project:update` passes (line 1686) → `assertProjectReadAllowed(trx, …, A)` runs the kernel with `action:'read'` (line 1690) → the `project:update` narrowing rule is never matched → allow → `ProjectModel.update` writes A (line 1691). The `own_or_assigned` update restriction is silently bypassed.
- **Delete a forbidden project.** `deleteProject(A)` → coarse `project:delete` passes (line 1819) → record check is `assertProjectReadAllowed(..., A)` with `action:'read'` (line 1823) → neither the `project:delete` nor the `project:update` narrowing rule is matched → delete proceeds.
- **Mutate tasks in a forbidden project.** `updateTaskWithChecklist(taskId, …)` → coarse `project:update` passes (`projectTaskActions.ts:614`) → resolve parent project A (line 620) → `assertProjectReadAllowedById(..., A)` read-scoped (line 624) → `ProjectTaskModel.updateTask` writes (line 630). Same gap on `addTaskToPhase`, checklist add/update/delete, task dependencies, resource assignment add/remove, ticket-link add/delete, `moveTaskToPhase`, `duplicateTaskToPhase`, reorder.
- **Staging mutations.** `stagingActions.ts` is the clearest illustration: `gate()` already takes `action: 'read' | 'update'` and does the *coarse* check with it (line 102) — then calls `assertProjectReadAllowed(db, …, projectId)` read-only regardless (line 106). The record gate ignores the action the caller just declared.
- **Status-mapping mutations.** `projectTaskStatusActions.ts` copy/remove/update/delete/reorder surfaces all go through its read-only local helper.

The finding's own framing ("read project A but denied by its project:update bundle rule can update/delete it and mutate its tasks") is accurate; the list above is the complete reachable surface.

---

## 2. The fix

### 2.1 Single enforcement home — the shared lib

`packages/projects/src/lib/projectReadAuthorization.ts` is already documented as "the one implementation" of the record-level project decision. **That is where the fix lives.** Make the kernel evaluation action-aware for writes and expose a mutation assert alongside the existing read assert, then migrate every mutation call site onto it.

### 2.2 Shape of the change in `projectReadAuthorization.ts`

1. **Widen the action type** to the real project record actions:
   ```ts
   export type ProjectRecordAction = 'read' | 'update' | 'delete';
   ```
   and use it on `createProjectReadAuthorizer(conn, tenant, user, action: ProjectRecordAction = 'read')`. (Keep the `read` default so existing read call sites are untouched.)

2. **Add a mutation assert that is strictly additive to security** — it must assert *both* the read record scope (so we never regress the protection that exists today) *and* the specific write-action scope:
   ```ts
   export async function assertProjectMutationAllowed(
     conn, tenant, user,
     projectId: string,
     action: 'update' | 'delete',
   ): Promise<IProject> {
     const project = await ProjectModel.getById(conn, tenant, projectId);
     if (!project) throw new Error('Project not found');

     const authorizeRead   = await createProjectReadAuthorizer(conn, tenant, user, 'read');
     const authorizeAction = await createProjectReadAuthorizer(conn, tenant, user, action);

     if (!(await authorizeRead(project)))   throw new Error('Permission denied: Cannot read project');
     if (!(await authorizeAction(project))) throw new Error(`Permission denied: Cannot ${action} project`);

     return project;   // callers (e.g. updateProject's beforeProject) reuse the loaded row
   }
   ```
   Returning the loaded `IProject` preserves the existing ergonomics of `assertProjectReadAllowed` (e.g. `const beforeProject = await …` at `projectActions.ts:1690`).

   *Optional refinement (leverage, not required for correctness):* extract a private `createProjectRecordAuthorizer` that resolves the subject + kernel once and returns `(project, action) => Promise<boolean>`, then have `createProjectReadAuthorizer` and `assertProjectMutationAllowed` both ride on it. This avoids resolving the subject twice per mutation and makes "one authorizer, action supplied per call" the real mechanism. Keep this behind the same observable behavior.

3. The error message for the read failure stays byte-identical (`'Permission denied: Cannot read project'`) so existing probing/parity tests and the contract test's `throw new Error('Permission denied: Cannot read project');` assertion (`projectAuthorization.contract.test.ts:129`) keep passing.

### 2.3 Migrate the mutation call sites (reads stay `read`)

Keep every `get*/list*/count*/search*/export*` path and `filterAuthorizedProjects` on `read`. Switch the **write** surfaces to `assertProjectMutationAllowed(..., 'update')`, or `'delete'` where the operation deletes a project:

- `projectActions.ts`: `updateProject` (1690, update), `deleteProject` (1823, **delete**), `updatePhase`, `markPhaseComplete`, `reopenPhase`, `deletePhase`, `addProjectPhase`, `reorderPhase`, `updateProjectStructure`, `addStatusToProject`, `updateProjectStatus`, `deleteProjectStatus` (all `update` — they mutate children of the project, not the project row itself).
- `projectTaskActions.ts`: every write surface listed in §1.4 (`updateTaskWithChecklist`, `addTaskToPhase`, checklist add/update/delete, `addTaskDependency`, resource add/remove, ticket-link add/delete, `moveTaskToPhase` + `duplicateTaskToPhase` — both source *and* target project, reorder) → `update`. The count/data getters (`getProjectTaskData`, `getPhaseTaskCounts`) stay `read`.
- `projectTaskStatusActions.ts`: copy/remove/update/delete/reorder mapping surfaces → `update`; `getProjectStatusMappings`, `getStatusMappingTaskCount` stay `read`.
- `phaseTaskImportActions.ts`: `importPhasesAndTasks` → `update`; `getImportReferenceData` stays `read`.
- `stagingActions.ts`: thread `gate()`'s existing `action` into the record check — call `assertProjectMutationAllowed(db, …, 'update')` when `action === 'update'`, else the read assert.
- `projectTaskExportActions.ts`: read — unchanged.

Because deletes map to a real `delete` action, a `project:delete`-scoped narrowing rule is honored, which the finding's "collapse to update" suggestion would have missed (§2.4).

### 2.4 Why this differs from the finding's suggested fix

The finding says "pass `read` for reads and `update` for all mutations **including deletes**." Passing `update` for a delete would *not* consult a `project:delete` bundle rule (actions are matched exactly — §1.2), so a delete-scoped narrowing would be silently skipped — the same class of bug, one action over. Threading the **true** action (`delete` for deletes) is the general, correct solution the engine's action-specific design already calls for.

Equally important: the fix is **additive** (read **and** write must both pass), not a replacement of `read` with `update`. Naively swapping `read`→`update` would *lose* read-narrowing enforcement: a tenant that narrows `project:read` but defines no `project:update` rule would fall through to `ALLOW_ALL` on the write and let a user mutate a project they cannot even read — a new hole. Requiring both scopes can never loosen today's behavior.

### 2.5 Is the shared helper a bypass-proof single point?

Authorization in this codebase lives at the server-action layer (the model layer has no user context), so there is no lower choke point than "every mutation action calls the shared assert." The mechanism that keeps this from silently regressing is the existing **source-contract test** `projectAuthorization.contract.test.ts`, which already pins the exact helper calls per surface. The fix extends that test (§3.3) to assert the mutation surfaces call the *mutation* helper, so a future edit that drops back to a read check fails CI. That contract test is the enforcement guarantee; the shared helper is the single implementation.

---

## 3. The proof (tests)

### 3.1 Helper-level regression — action is actually threaded (primary)

New test `packages/projects/src/lib/projectReadAuthorization.mutation.test.ts`. Mock `@alga-psa/authorization/kernel` so `createAuthorizationKernel` returns a fake whose `authorizeResource(input)` records `input.resource.action` and returns `allowed` from a per-action map, and mock `../models/project` `getById`. Assertions:

- `assertProjectMutationAllowed(conn, t, u, 'A', 'update')` calls the kernel with **both** `action:'read'` and `action:'update'` for project A.
- With the map `{ read: allow, update: deny }`, it **throws** `Permission denied: Cannot update project`.
- With `{ read: allow, delete: deny }`, `assertProjectMutationAllowed(..., 'delete')` throws `Permission denied: Cannot delete project` and the kernel saw `action:'delete'` (proves deletes are not collapsed to update).
- With all-allow, it returns the loaded project.

**Why it fails before the fix:** `assertProjectMutationAllowed` does not exist, and the only record helpers evaluate `action:'read'` exclusively — there is no code path that ever asks the kernel about `update`/`delete`, so the "kernel saw action:update/delete" assertions cannot pass.

### 3.2 Action-layer behavioral regression — mutations are blocked (primary)

New test `packages/projects/src/actions/projectMutation.authorization.test.ts`, modeled on the existing `projectTaskCommentActions.authorization.test.ts` harness (mock `@alga-psa/db`, `@alga-psa/auth`, `@alga-psa/auth/rbac`, `../models/project`, and `../lib/projectReadAuthorization`). Configure the mocked lib so the read authorizer allows project A but the **mutation** assert denies `update`/`delete` on A. Assertions:

- `updateProject('A', { … })` returns a permission error / throws, and `ProjectModel.update` is **not** called.
- `deleteProject('A')` is blocked and no delete runs.
- `updateTaskWithChecklist(taskInA, …)` is blocked and `ProjectTaskModel.updateTask` is **not** called.
- Parity: a forbidden-project mutation and an unknown-id mutation return the same shape (no oracle).

**Why it fails before the fix:** today these actions call the read-only `assertProjectReadAllowed` / `assertProjectReadAllowedById`, which the mock allows for A, so `ProjectModel.update` / `updateTask` **are** called and the mutation succeeds — the `not.toHaveBeenCalled()` assertions fail. After the fix they call `assertProjectMutationAllowed`, which the mock denies, so the writes are blocked.

### 3.3 Contract-test extension — pin the enforcement at every write site

Extend `packages/projects/src/actions/projectAuthorization.contract.test.ts` to assert:

- `projectReadAuthorizationSource` contains `export async function assertProjectMutationAllowed(` and `export type ProjectRecordAction`.
- The write surfaces call it, e.g. `assertProjectMutationAllowed(trx, tenant, user as IUserWithRoles, projectId, 'update')` in `projectActions.ts`/`projectTaskActions.ts`/`projectTaskStatusActions.ts`, and the `'delete'` variant in `deleteProject`.
- Existing read-site assertions (lines 41, 53, 77, 92, 101, 133–139, etc.) are updated **only** for the surfaces that move to the mutation helper; the genuinely read-only ones (exports, counts, list/detail) keep their `assertProjectReadAllowed(...)` assertions. This file **will fail** until both the source and its own expectations are updated — that is the intended coupling, and the signal that no mutation site was missed.

**Why it fails before the fix:** the `assertProjectMutationAllowed`-shaped strings do not exist in source yet.

---

## 4. Scope not covered / risks for the reviewer

- **`create`/`mutationDeniedReason` guards are out of scope.** `project:create` has no existing record to authorize (there is no row yet), so it is unchanged. The kernel's mutation-stage guards (`authorizeMutation` → `not_self_approver`, `bundleProvider.ts:132-139`) are a separate path only reached via `authorizeMutation`, which these helpers do not call; wiring project mutations through `authorizeMutation` is a larger, independent change and is deliberately **not** done here. If the reviewer wants self-approval-style guards on project writes, that is a follow-up card.
- **Semantic choice: writes now require read *and* write scope.** This is intentionally conservative (§2.4) and can only tighten. The one behavior it would change is an unusual config where `project:update` is authored *broader* than `project:read` (update allowed on a project the user can't read); such a user would now be blocked from updating. This is the safe reading for a security fix, but the reviewer should confirm no bundle in use intentionally grants write-without-read.
- **Breadth of migration.** ~30+ mutation call sites across five files move to the new helper. Risk is an *omission* (a write left on the read helper). Mitigation: the contract test (§3.3) enumerates the surfaces, and a `grep` for `createProjectReadAuthorizer(`/`assertProjectReadAllowed` in mutation actions is part of the implementation checklist. No call site is removed; reads are untouched.
- **Performance.** `assertProjectMutationAllowed` resolves the authorization subject/kernel twice per call (read + write) unless the optional §2.2.3 single-authorizer refinement is taken. Per CLAUDE.md, build effort is not a decision factor; the refinement is the cleaner layering and is recommended but not required for correctness.
- **Not touched:** `filterAuthorizedProjects` and all list/detail read authorization (correct as-is), the kernel/engine/bundle provider (already correct — the bug was entirely in the callers), and the coarse RBAC `checkPermission` calls (correct and retained as the first gate).
- **Unrelated working-tree change:** the pre-existing unstaged `package-lock.json` modification is left as-is and is not part of this work.
