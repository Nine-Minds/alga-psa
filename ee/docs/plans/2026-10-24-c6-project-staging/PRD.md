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
