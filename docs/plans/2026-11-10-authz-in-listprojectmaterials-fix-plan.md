# Fix plan — Security: record-level project authz in project-material actions

- **Card:** e4162f08-58fc-529c-a285-a0315d41016d — *Security: authz in listProjectMaterials*
- **Source:** security review of PR #3987 (merge `e75baf12b57c`), finding `f3`, severity **high**
- **Fingerprint:** `packages/projects/src/actions/materialCatalogActions.ts#listProjectMaterials`
- **Verdict:** **Finding confirmed.** The project-material server actions enforce only the coarse `project:read` / `project:update` RBAC permission and never run the record-level project decision, so a bundle-narrowed MSP user can reach projects outside their bundle scope. The fix, the enforcement point, and the regression test are below. No implementation exists on this branch yet.

---

## 1. The defect, precisely

All five project-material server actions in `packages/projects/src/actions/materialCatalogActions.ts` take a caller-supplied `projectId` (or a `projectMaterialId` that resolves to one) and gate **only** on the coarse tenant-wide RBAC permission. None of them run the record-level ("does *this* project fall inside the caller's bundle scope?") decision.

| Action | File:line | Coarse gate only | Reaches unguarded |
|---|---|---|---|
| `getProjectMaterialBillingOptions` | `materialCatalogActions.ts:91-121` | `project:read` at `:96-98` | reads `project_billing_configs` + `project_billing_schedule_entries` for the supplied `projectId` (`:100-120`) |
| `listProjectMaterials` | `materialCatalogActions.ts:146-164` | `project:read` at `:152-154` | `listMaterials(db, tenant, 'project', projectId)` (`:156`) → `materials.ts:146-177`, filters on `tenant` + `project_id` only |
| `addProjectMaterial` | `materialCatalogActions.ts:166-207` | `project:update` at `:185-187` | `addMaterial(...)` (`:189-194`) → inserts a `project_materials` row + billing state (`materials.ts:285-303`) and consumes inventory (`materials.ts:339-349`) |
| `updateProjectMaterial` | `materialCatalogActions.ts:209-230` | `project:update` at `:220-222` | `updateProjectMaterialBilling(db, tenant, projectMaterialId, input)` (`:224`) → `materials.ts:391-472`, locates the material by id with no project-scope check |
| `deleteProjectMaterial` | `materialCatalogActions.ts:245-263` | `project:update` at `:251-253` | `deleteMaterial(db, tenant, 'project', projectMaterialId, …)` (`:255`) → `materials.ts:528-558` |

**Why coarse RBAC is not enough.** The canonical record-level helper documents this exact gap: the coarse permission "says the user may work with projects at all; it says nothing about *this* project. Bundle narrowing can restrict a user to a subset of the tenant's projects, so any action that accepts a projectId has to run the kernel decision for that record too" (`packages/projects/src/lib/projectReadAuthorization.ts:1-11`). Bundle narrowing is published as `authorization_bundle_rules` rows of `resource_type='project', action='read'` (`packages/authorization/src/bundles/starterBundles.ts:30`) and is evaluated by the kernel inside `createProjectReadAuthorizer` (`projectReadAuthorization.ts:102-140`). The sibling material surface — project staging — already runs it on **every** operation, read and write, via its `gate()` helper (`packages/projects/src/actions/stagingActions.ts:96-108`). The material-catalog actions are the one project-scoped surface that was never brought behind it. (The lib layer is authz-free by design — `materials.ts:29-35` — "Permission gating stays in the wrappers (they hold the user)"; so this is a wrapper defect, not a lib defect.)

**Concrete attacker path.** A tenant MSP user who holds `project:read`/`project:update` through some role but is narrowed by a published bundle to, say, only *Client A*'s projects:
1. **Read exfiltration.** Call `listProjectMaterials("<Client-B project id>")` → returns Client B's material lines, rates, currencies and SKUs. Call `getProjectMaterialBillingOptions("<Client-B project id>")` → returns Client B's billing currency and full billing schedule. The bundle that should hide Client B's projects is never consulted.
2. **Write / tamper.** Call `addProjectMaterial({ project_id: "<Client-B project id>", … })` → inserts a material line, writes billing state, and **consumes real inventory** (`recordStockConsumption`, `materials.ts:339-349`) against a project the user may not see. Call `updateProjectMaterial(<Client-B project_material_id>, …)` to rewrite a rate/billing destination, or `deleteProjectMaterial(<Client-B project_material_id>)` to remove a line and reverse its stock consumption. The `projectMaterialId` is attacker-supplied and resolves to any project in the tenant.

This is a cross-bundle horizontal-authorization break inside a single tenant. It was present before PR #3987 (the PR did not introduce it); the card exists to close it on `main`.

**Not in scope / not defective (evidence):** `searchServiceCatalogForPicker` (`:123-133`), `getServicePrices` (`:135-144`) and `listAvailableStockUnitsForMaterial` (`:233-243`) operate on the tenant-wide service catalog / inventory and take a `serviceId`, not a project — they correctly gate on their own resources (catalog read is implicit via tenant scope; `listAvailableStockUnitsForMaterial` gates `inventory:read` at `:238`). They carry no per-project record and are deliberately excluded.

---

## 2. The fix

**One file changes: `packages/projects/src/actions/materialCatalogActions.ts`.** Reuse the existing shared record-level helper — do not add a new mechanism. `assertProjectReadAllowed(conn, tenant, user, projectId)` (`projectReadAuthorization.ts:146-163`) loads the project and throws `Permission denied: Cannot read project` unless the caller's bundle scope admits that record. It is the single implementation already used by project, task, staging, import and export actions (`projectReadAuthorization.ts:8-11`), so routing the material actions through it means the same class of bug cannot diverge across surfaces.

### Enforcement design — one transaction-scoped gate per action

Mirror `stagingActions.gate()` exactly (`stagingActions.ts:96-108`): coarse RBAC first (unchanged), then the record-level decision, then the operation — all on the same connection/transaction so the resolved project cannot drift between the check and the write. Add two private helpers to `materialCatalogActions.ts`:

```ts
import type { Knex } from 'knex';
import type { IUserWithRoles } from '@alga-psa/types';
import { assertProjectReadAllowed } from '../lib/projectReadAuthorization';

// Resolve a project_material_id to its parent project, scoped to tenant.
// Returns null when the material does not exist in this tenant.
async function resolveProjectIdForMaterial(
  conn: Knex | Knex.Transaction, tenant: string, projectMaterialId: string,
): Promise<string | null> {
  const row = await conn('project_materials')
    .where({ tenant, project_material_id: projectMaterialId })
    .first('project_id');
  return row?.project_id ?? null;
}
```

Then wrap each action in `withTransaction(db, async (trx) => { … })` and run the record decision inside it, passing `trx` down to the lib functions (which reuse a passed-in transaction via `runInTransaction`, `materials.ts:21-27`) so the check and the operation are atomic:

- **`getProjectMaterialBillingOptions`** — already uses `withTransaction` (`:100`). After the coarse `project:read` gate, add `await assertProjectReadAllowed(trx, tenant, user as IUserWithRoles, projectId);` as the first statement inside the transaction, before the billing-config query.
- **`listProjectMaterials`** — after the coarse `project:read` gate, open `withTransaction(db, async (trx) => { await assertProjectReadAllowed(trx, tenant, user as IUserWithRoles, projectId); return listMaterials(trx, tenant, 'project', projectId); })`. `listMaterials` accepts a transaction and reuses it.
- **`addProjectMaterial`** — after the coarse `project:update` gate, open `withTransaction` and `await assertProjectReadAllowed(trx, tenant, user as IUserWithRoles, input.project_id);` before `addMaterial(trx, tenant, …)`. Passing `trx` makes the authorization, the billing-state insert, and the inventory consumption one atomic unit.
- **`updateProjectMaterial`** / **`deleteProjectMaterial`** — these take a `projectMaterialId`. Inside `withTransaction`: `const projectId = await resolveProjectIdForMaterial(trx, tenant, projectMaterialId);` then **treat a missing material exactly like an unauthorized one** — `if (!projectId) return permissionError('Permission denied: project update required', 'projects:errors.permissions.materialUpdate');` — then `await assertProjectReadAllowed(trx, tenant, user as IUserWithRoles, projectId);`, then call `updateProjectMaterialBilling(trx, …)` / `deleteMaterial(trx, …)`. Resolving-then-authorizing in the same transaction closes the id-to-project indirection the attacker used.

**Error flow is already handled.** `assertProjectReadAllowed` throws an `Error` whose message contains `Permission denied`; `projectMaterialActionErrorFrom` (`materialCatalogActions.ts:35-47`) already maps any such message to a `permissionError`, and every action already funnels its `catch` through that mapper. So the thrown record-level denial surfaces to the UI as a clean permission error with no extra plumbing. The `'Project not found'` throw from `assertProjectReadAllowed` (`projectReadAuthorization.ts:154`) is only reachable for a `projectId` the caller *passed* (read/add paths); for the material-id paths we convert missing → permission error ourselves (above), matching the staging rule that "a project the caller may not read answers exactly like a missing one" (`stagingActions.db.test.ts:2-3`).

**Why the wrapper, not the lib.** `materials.ts` is intentionally user-less (`materials.ts:29-35`) and is shared by the ticket wrapper, the billing wrapper and the REST API `TicketService`, each of which owns its *own* resource's record decision (e.g. `ApiProjectController.assertProjectReadAllowed`, `server/src/lib/api/controllers/ApiProjectController.ts:82`). Pushing project authz into the lib would wrongly impose project semantics on ticket/billing callers. The correct single enforcement point for *project*-material operations is this wrapper — once all five entry points route through `assertProjectReadAllowed`, there is no other code path that reaches `listMaterials`/`addMaterial`/`updateProjectMaterialBilling`/`deleteMaterial` for a project without the record decision.

**Shared-helper home:** yes — `assertProjectReadAllowed` is already the right, already-existing home. No new abstraction is warranted; this fix brings the last project surface into line with it. (Record action is `'read'` on purpose: bundle narrowing rules are published for `project:read` and drive project *visibility*; the coarse `project:update` check remains the write gate. This is exactly what `stagingActions.gate()` does for its update operations.)

---

## 3. The proof (regression tests)

Add `packages/projects/src/actions/materialCatalogActions.db.test.ts`, modeled directly on `stagingActions.db.test.ts` (`:1-120`), which already builds the fixture this needs: a `RESTRICTED` user narrowed by a **published authorization bundle** (`resource_type='project', action='read', template_key='selected_clients'`, config `{ selectedClientIds: [CLIENT_A] }`) against the real migrated inventory test DB, with the real kernel and RBAC stubbed per-case. Each case runs in a transaction that is rolled back.

Fixture: `projectA` under Client A (in the restricted user's bundle) and `projectB` under Client B (outside it), plus one `project_materials` row on each. `testState.user = RESTRICTED`, `testState.permissions = new Set(['project:read','project:update','inventory:read'])` (coarse grants present — proving the *record* decision, not RBAC, is what blocks).

1. **`listProjectMaterials` denies an out-of-bundle project.** Call `listProjectMaterials(projectB.id)` → expect `isActionPermissionError(result)` true (not the material rows). **Fails before the fix:** today the coarse `project:read` passes and `listMaterials` returns Client B's rows.
2. **`listProjectMaterials` still allows an in-bundle project.** `listProjectMaterials(projectA.id)` → returns the array of material rows (no regression for legitimate access).
3. **`getProjectMaterialBillingOptions` denies out-of-bundle.** `getProjectMaterialBillingOptions(projectB.id)` → permission error. **Fails before the fix:** returns Client B's billing currency + schedule.
4. **`addProjectMaterial` denies out-of-bundle and writes nothing.** `addProjectMaterial({ project_id: projectB.id, … })` → permission error, and a post-call `trx('project_materials').where({ project_id: projectB.id })` count is unchanged (no insert, no inventory consumed). **Fails before the fix:** coarse `project:update` passes and a row + stock consumption are created.
5. **`updateProjectMaterial` denies out-of-bundle via the material id.** `updateProjectMaterial(projectB_material_id, …)` → permission error, and the row's rate/billing_destination are unchanged. **Fails before the fix:** `updateProjectMaterialBilling` locates the material by id with no project scope and updates it.
6. **`deleteProjectMaterial` denies out-of-bundle via the material id.** `deleteProjectMaterial(projectB_material_id)` → permission error, and the row still exists afterward. **Fails before the fix:** `deleteMaterial` removes the row and reverses stock.
7. **In-bundle write still succeeds.** `addProjectMaterial({ project_id: projectA.id, … })` (and/or update/delete against `projectA`'s material) succeeds, proving the gate does not break legitimate use.

Each denial case asserts both the permission-error response **and** the absence of a side effect (the behavioral half), so a test cannot pass by coincidence of error mapping alone.

Optionally extend the existing source-contract test `packages/inventory/src/lib/materialAuthorizationParity.contract.test.ts` (the projects case at `:26-32`) to assert the projects wrapper now also contains `assertProjectReadAllowed`, matching how `projectAuthorization.contract.test.ts` pins the other project surfaces. This is a cheap guard against the gate being removed later, but the DB test above is the authoritative behavioral regression.

---

## 4. Scope not covered, and risks for the reviewer

**Deliberately not doing:**
- **Ticket materials** (`packages/tickets/src/actions/materialCatalogActions.ts`) and the **billing** wrapper (`packages/billing/src/actions/materialActions.ts`) — out of this finding's scope; they own different resources (`ticket:*`, `billing:*`) and their record-level stories are separate. Not touched here.
- **The lib layer** (`materials.ts`) — left authz-free by design; no change.
- **`searchServiceCatalogForPicker` / `getServicePrices` / `listAvailableStockUnitsForMaterial`** — not project-scoped (§1); unchanged.
- **Client-portal exposure** — these are MSP server actions; no new client-portal surface is introduced or evaluated.

**Risks / regressions to weigh:**
1. **Record action choice (`read` vs `update`).** The plan uses the record-level `read` decision for write operations (coarse `project:update` still gates write capability), mirroring `stagingActions.gate()`. If a reviewer believes bundle narrowing should distinguish write visibility, that is a cross-cutting change to the kernel/bundle model, not to these actions — flag, don't fork here.
2. **Missing-material → permission error.** `updateProjectMaterial`/`deleteProjectMaterial` will return a `permissionError` (not the current `MaterialValidationError` "Project material not found" `actionError`) when the id does not exist, to avoid an existence oracle and to match staging's "missing answers like denied." This is a minor behavioral change to the not-found path; confirm the UI does not depend on the old error code.
3. **Transaction wrapping of writes.** `addProjectMaterial` currently passes a plain `db` to `addMaterial`, which opens its own transaction; the plan passes a `trx` instead so authz + write are atomic. `recordStockConsumption` and the post-commit asset/stock-low hooks (`materials.ts:374-388`) run *after* the lib's transaction returns the row — these hooks fire on the `db`/`trx` handle; verify that passing the outer `trx` keeps the post-commit asset creation (lazy `assetLink` import) and `INVENTORY_STOCK_LOW` publish behaving as before (they execute after the `runInTransaction` block resolves, so they are unaffected by reusing the caller's transaction, but this should be exercised by the in-bundle success case).
4. **Extra query cost.** Each call now runs the kernel decision (subject + bundle-rule resolution) once; `createProjectReadAuthorizer` builds a `RequestLocalAuthorizationCache` per call. This matches every other project action and is not a new performance pattern.
5. **Not a tenant-isolation fix.** This closes *intra-tenant* cross-bundle access. Tenant scoping (every query already filters `tenant`) is unchanged and was not the gap.
