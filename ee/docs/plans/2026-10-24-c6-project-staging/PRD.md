# PRD: Project staging, boxes and manifests (C6)

Card alga-2026-0002683 (6/6). Design of record: `ee/docs/plans/2026-10-20-physical-work-tags/design-C6-project-staging.md` (commit 5d4945b7b0, decisions D1-D13). Where this PRD and the design differ, the design wins. Background: `ANALYSIS.md`, `PLAN.md` in `2026-10-20-physical-work-tags/`.

## Problem
A project cannot reserve equipment ahead of installation. Materials consume stock the moment they are added, and every `project_materials` row is billable. Teams that pre-pick hardware for a rollout cannot claim it, pack it into labelled boxes, or print a packing manifest without consuming stock or billing it.

## Goals
- A project can reserve stock (all-or-nothing, one location), stage it, and pack it into labelled boxes with manifests.
- Stock is consumed only at install, through the existing `addMaterial` path.
- Reservations share the existing `reserved_quantity` / `held_quantity` counters (no second ledger) and survive "Rebuild stock caches".
- Printing labels or manifests is strictly read-only.
- Client-provided items can be tracked through staging without ever touching stock or billing.

## Non-goals (design section 5)
Dispatch/transit/on-site receipt; ticket staging; kits; mobile screens; stored manifests or print history (C2 decided: prints write nothing); partial reservations or backorders; record-level checks on existing Materials actions; new events; labels for quantity lines.

## Users and flows
Project manager / warehouse tech: reserve items on a project, stage them, pack into boxes, print box labels and manifests, install on site, release or undo. Sales order users: see less free stock, never lose or poach project claims.

## Key decisions (summary of D1-D13)
- Lines live in `project_staging_lines`; not `project_materials` (billing untouched).
- `reserved` = soft claim on `reserved_quantity`; `staged` = hard claim on `held_quantity`. Serialized units go `in_stock -> allocated` with `stock_units.allocated_staging_line_id`.
- Engine: extract `lib/allocation.ts`; `consume.ts` gains `location_id` and `claimant`; reconcile adds staging claims; `loadCandidateUnits` treats project-claimed units as foreign hard holds.
- Boxes: `staging_containers`, `staging_container_members`; identifier `<project_number>-B<nn>`; "n of m" computed at render.
- Labels: class `staging-container`, entity `staging_container`, `LabelViewModel.sequence`, mixed `items` in `printLabels`. Manifest: document type `staging-manifest`, `GET /api/projects/staging/containers/[id]/manifest`.
- Auth: `project:read` / `project:update` plus record-level project decision via one shared `createProjectReadAuthorizer`. Missing and forbidden box both 404.
- CE only; plan docs are the only `ee/` content.

## D9 branch taken
C4 (custody) has no PR as of 2026-10-24. Branch: `client_asset` lines are plain links to an asset of the project's client; custody is a follow-up. The implementation's draftSummary must say so.

## Re-verification against main (2026-10-24, origin/main 484bfecb8f)
- `salesOrderActions.ts`: `resolveAllocationLocation` (247), `allocateLine` (264), `reverseAllocationCounter` (330), `releaseAllocations` (352) are still private. No drift.
- `lib/levels.ts`: `availableQuantity`, `ensureStockLevel`, `applyOnHandDelta`, `recomputeSerializedOnHand`, `applyAllocationDelta` as described.
- `lib/reconcile.ts`: `computeAllocationsFromTruth` (32) exists, sales orders only.
- `fulfillmentActions.ts` `loadCandidateUnits` (132) still computes `foreign_hard_hold` from `allocated_so_line_id` only (151). Guard still needed.
- C2 (#3879) landed: `server/src/lib/labels/printLabels.ts` still takes a single `labelClass` + `ids` (cap 200, `UUID` validation); `LABEL_CLASSES` still three classes; `RECORD_ENTITY_TYPES` has ticket, asset, project, project_task, stock_unit, rma; label AST dir is `packages/billing/src/lib/label-template-ast/` (bindings, labelTemplates, sampleData, standardTemplates). Types and mobile `recordLinks.ts` are byte-identical now.
- **C2 print-history decision: none.** Prints write nothing (design-C2 section 3). C6 adopts that; nothing to add.
- `createProjectReadAuthorizer` is still private in `projectActions.ts:374` and `projectTaskActions.ts:383`. Note `projectAuthorization.contract.test.ts:28` asserts the source of the private function in `projectActions.ts`; the extraction must update that contract test.
- B1 (#3818): OPEN, head `dea428483c`. Not yet in main, so `evaluateConsumption` and `InsufficientStockError.detail` do not exist on main (`consume.ts` has `InsufficientStockError` only).
- Branch is rebased on origin/main; `package-lock.json` clean.

## Gate
Implementation is blocked until #3818 merges. If B1's final shape differs from `dea428483c`, adapt D7 but keep semantics: release the line's own claim, then apply the free-stock rule.

## Risks
See design section 6: stale reservations starving stock, B1 soft override consuming project-reserved stock, non-serialized SO fulfilment warn-only, cycle counts with allocated units, mobile parity test with C3, stale "n of m", 200-label cap.

## Acceptance criteria
Every feature in `features.json` implemented; every test in `tests.json` passing, including: reserve respects availability; printing/scanning changes nothing; SO suites `alloc.db.test.ts`, `flows.db.test.ts`, `salesOrderGuards.db.test.ts` unmodified and green; recordLinks parity green; typecheck and build clean.

## Implementation record (2026-10-25)

Gate: B1 merged as `352dab4d35` (#3818); its `consume.ts` and `materials.ts` are byte-identical to `dea428483c`, so D7 needed no adaptation. C2 merged (#3879). C4 (#3890) is still open, so **D9 took the no-C4 branch**: `client_asset` lines are plain links to an asset of the project's client, and custody is a follow-up.

Where the build differs from the design text, and why:
- `createProjectReadAuthorizer` lives in the existing shared `packages/projects/src/lib/projectReadAuthorization.ts` (which already held `assertProjectReadAllowed`), not a new `projectReadAuthorizer.ts`. `assertProjectReadAllowed` now uses it; both private copies are gone and three contract tests follow the move.
- Mixed-item `printLabels` keeps the skip-and-count rule C2 shipped for single-class batches (unreadable records are skipped and counted; all unreadable is the uniform 404), instead of "any null → 404".
- Deleting an empty box is a soft delete (`deleted_at`) so its number is never reused; deleted boxes are invisible to labels, manifests and "n of m".
- Standard template codes follow the existing naming: `standard-staging-container-label`, `standard-staging-manifest`.
- `reverseStockConsumption` now restores non-serialized stock at the location the consume movement drew from (needed for D8 undo of an install at a non-default location; previously it used the current default).
- The B1 material dialogs (tickets and projects) now say stock is held or reserved "for sales orders or projects", in every locale, in addition to the generalised `consume.ts` messages.
- The manifest's owner and status words are localized from the `documents` namespace at render time.
- No separate billing-run preview test: T007 proves reserve, stage and pack write no `project_materials` row, and billing reads only that table.

Not verified in this run: the mobile workspace's recordLinks parity test could not start locally (Expo deps not installed in this worktree); byte identity was checked with `cmp`. No signed-in browser smoke test: the shared dev stack's login password was not available; the page and manifest routes were checked unauthenticated (redirect to sign-in, 401, 404).

## Repair round (2026-10-25, PR #3892 review)

**Task / phase / project delete policy.** Deleting a task must never leave phantom claims or fail on a raw FK error.
- `releaseStagingForTasks` / `releaseStagingForTask` / `releaseStagingForProject` (inventory `staging.ts`) run inside the delete transaction. Live lines (`reserved`/`staged` stock, `received`/`staged` client) are released through the same `releaseLineInTransaction` that `releaseLines` uses: counters return via `releaseCounter`, serial units return to `in_stock` with `allocated_staging_line_id` cleared, and the lines leave their boxes (a sealed box holding such a line is reopened first, as in "release all").
- **Installed lines** own a `project_materials` row and are never cascaded away or refused: they are detached (`task_id = NULL`) and stay on the project as history. Released lines are detached the same way.
- **Boxes** on the task are detached (`task_id = NULL`) and stay on the project.
- Migration `20261025080000_staging_task_fks_no_cascade.cjs` changes `project_staging_lines_task_fk` from CASCADE to NO ACTION (SET NULL cannot be used: the composite key includes the NOT NULL `tenant`). `staging_containers_task_fk` was already NO ACTION. A delete path that skips the helper now fails loudly instead of orphaning claims. The original migration is untouched.
- Paths covered: `deleteTask` action, `ProjectModel.deletePhase` (and the `deletePhase` action through it), `ProjectModel.delete` (and `deleteProject` through it; project delete releases every live claim and removes the project's boxes, members and lines before its tasks go), and the REST `ProjectService.deleteTask` / `deletePhase` (now transactional and routed through the helper). No known gap.

**Permission gates.** `installProjectStagingLines` needs `project:update` + record-level read + `billing:create` (same gate as the billing material wrapper, since install creates a billable material); denial consumes nothing. `getProjectStagingAvailability` needs `inventory:read` as well as the project gate. `addProjectClientItems` needs `asset:read` when any item carries an `asset_id`; the refusal is permission-level and reveals nothing about the asset.

**Low-stock signal.** A staging install evaluates the low-stock signal at the line's claim location (`collectStockLowSignalAfterConsume`); ordinary materials keep the default-location behaviour. Serialized units never signal.

**Shared helper hardening.** `releaseClaimedUnits` selects the units `FOR UPDATE`.
