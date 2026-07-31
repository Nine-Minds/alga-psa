# Project Fixup Round 2 — Implementation Plan

**Date:** 2026-07-29
**Branch:** `fix/project-fixup-round-2`
**Status:** Approved design — ready for implementation
**Predecessor:** `docs/plans/2026-07-28-project-billing-fixups-plan.md`

## Context

Field testing after the first project-billing fixup pass exposed a second set of gaps. Project products still have only a billed/unbilled state, so every unbilled product in the invoice currency is pulled into whichever standalone project invoice is generated next. Operators cannot hold a product, attach it to a particular milestone, wait for project completion, or deliberately bill it on a product-only invoice. Product pricing controls also omit useful cost context and do not expose the existing per-row rate as an editable override.

Two adjacent correctness problems are included: fixed-price schedule entries cannot be entered as zero-dollar product-only billing events in the UI, and an under-allocated schedule can warn without offering to make the project total match the visible schedule. Separately, project-task Actual Hours remains manually editable and is inconsistently maintained from billable minutes rather than actual elapsed time.

This plan covers only the clarified items from the first handwritten page supplied during the design session. The entire second page and the final disregarded line on page one are explicitly out of scope.

## Goals

1. Give MSP billing staff explicit, per-product control over when and how a project product is invoiced.
2. Make mixed-currency product billing safe and reviewable without adding FX conversion.
3. Support zero-dollar phases/milestones that exist solely to invoice assigned products.
4. Let an operator resolve an under-allocated schedule by making the project total match the visible schedule amounts.
5. Show product cost as read-only pricing context and allow a per-row project sale-price override.
6. Make project-task Actual Hours a trustworthy, read-only calculation from linked time entries.

## Non-goals

- Items from the second handwritten page (opportunity setup, translations, layout polish, invoice tax presentation, accounting-integration wording, dark mode, approval queue questions, and related notes).
- FX conversion or mixed currencies within one invoice.
- Editing catalog prices or product/inventory cost from a ticket or project.
- Project-wide product price overrides; overrides apply to one added project-product row only.
- Automatic invoice approval, finalization, or accounting export.
- Changing ticket-material billing timing or adding ticket-material price overrides.
- Replacing the existing project billing model, schedule lifecycle, or invoice approval workflow.

## Settled Product Behavior

Each unbilled project product has an **Invoice with** choice:

1. **Next project invoice** — eligible for the next project invoice; the backward-compatible default.
2. **Specific phase/milestone** — eligible only when the selected project billing schedule entry is invoiced. The UI labels choices with phase and milestone context, but storage targets the schedule entry because a phase may have more than one billing event.
3. **Separate product invoice** — excluded from project phase invoices and available in the product-invoice review flow.
4. **When project is completed** — excluded while the project is open and eligible for project invoicing after the project transitions to a closed status. Completion does not generate an invoice automatically.
5. **On hold** — never eligible until an operator changes the choice.

Additional rules:

- Existing rows migrate to **Next project invoice** to preserve current behavior.
- New same-currency rows default to **Next project invoice**.
- A product whose currency differs from the project billing currency is forced to **Separate product invoice**. It cannot target the next project invoice or a schedule entry.
- Canceling or deleting an assigned schedule entry moves its unbilled products to **On hold** and surfaces a warning; products are never silently rerouted.
- Billing destination and sale price are editable only while the row is unbilled.
- Invoice creation always marks exactly the product rows persisted as invoice lines, never every unbilled row that merely shares a project and currency.

## Workstream A — Project-product billing intent and eligibility

### A1. Schema and types

Add a Citus-safe migration for `project_materials`:

- `billing_destination text NOT NULL` with allowed values `next_project_invoice`, `schedule_entry`, `separate`, `project_completion`, and `on_hold`.
- `billing_schedule_entry_id uuid NULL` for the `schedule_entry` destination.
- A CHECK constraint requiring `billing_schedule_entry_id` exactly when `billing_destination = 'schedule_entry'`.
- A tenant-scoped composite foreign key from `(tenant, billing_schedule_entry_id)` to `project_billing_schedule_entries (tenant, schedule_entry_id)`. Use `NO ACTION`; application transactions must move linked products to `on_hold` before deleting an entry so Citus/Postgres never performs a tenant-unsafe `SET NULL`.
- Eligibility indexes beginning with the distribution key, covering `(tenant, project_id, is_billed, billing_destination, currency_code)` and `(tenant, billing_schedule_entry_id)`.

Backfill existing rows to `next_project_invoice`, then install the default and constraints. Keep billed rows valid even though the destination no longer affects them. Update `IProjectMaterial` and the corresponding server/type mirrors.

### A2. Canonical material update support

Extend `packages/inventory/src/lib/materials.ts` with a tenant-scoped update path rather than writing `project_materials` directly from UI actions. The project wrapper requires `project:update` and permits changes only on unbilled rows. This cleanup needs updates for:

- snapshotted sale `rate` (the per-row override),
- `billing_destination`, and
- `billing_schedule_entry_id`.

The service validates that the schedule entry belongs to the same project's billing config, that the destination/link combination is valid, and that mismatched currency can only use `separate`. Do not mutate catalog prices, inventory cost, quantity, consumed stock, or billed rows in this update path.

### A3. Eligibility resolver

Introduce one server-side eligibility predicate used by previews and generation:

- `next_project_invoice`: eligible for any targeted project invoice.
- `schedule_entry`: eligible only when its linked entry ID is among the invoice's selected entry IDs.
- `separate`: eligible only for the separate-product action.
- `project_completion`: eligible only when `projects.is_closed = true`.
- `on_hold`: never eligible.

Do not duplicate these rules between the billing engine and UI. The UI may explain eligibility, but the server is authoritative and locks/rechecks rows when generating invoices.

### A4. Schedule and project lifecycle integration

In the same transaction that cancels or deletes a project billing schedule entry, update its unbilled linked products to `on_hold`, clear `billing_schedule_entry_id`, and return a warning/count for the UI. Apply the same rule to the bulk schedule cancellation performed by `closeProjectBillingSchedule` during project completion. Products using `project_completion` remain eligible because the project is now closed; the close operation does not auto-invoice them.

## Workstream B — Correct project and product-only invoice generation

### B1. Select exact products for project invoices

Refactor `BillingEngine.calculateMaterialCharges` so targeted project billing loads only rows allowed by the eligibility resolver and attaches the source `project_material_id` to each transient product charge. `generateProjectInvoice(projectId, entryIds)` must pass the selected schedule-entry IDs through product selection.

Replace the current broad post-persistence update in `invoiceGeneration.ts`—which marks every unbilled project material in the invoice currency—with an update by the exact material IDs whose charges were persisted. Perform invoice-charge persistence, schedule transitions, cap updates, and product billing links in the same transaction. Preserve existing hard-delete/unfinalize behavior that clears material billing links by `billed_invoice_id`, and add coverage for the new product-only drafts.

### B2. Mixed-currency behavior

A project invoice remains single-currency. Same-currency eligible products may accompany its schedule charges. Mismatched products are excluded because they must have the `separate` destination; do not silently skip a row whose persisted destination says it should be on the current invoice—treat that as invalid state and surface an actionable error.

No FX conversion, exchange-rate lookup, or converted margin is introduced.

### B3. Separate product-invoice review flow

Add **Create product invoices** to the project's Materials & Products area for users who have both project update and billing-create authority.

The review dialog:

- loads unbilled `separate` rows,
- groups them by currency,
- preselects every eligible row while allowing deselection,
- shows product, quantity, overridden unit price, extended amount, and currency,
- previews the number of draft invoices and the total for each currency, and
- creates one draft invoice per represented currency, with no automatic approval or finalization.

Implement a dedicated server action/service rather than calling the authenticated `generateManualInvoice` server action from another server action. Reuse its internal invoice-number, tax, charge-persistence, and total-calculation services. In one tenant transaction, lock and revalidate the selected material IDs, create the currency-grouped drafts with the project/client association, persist product charges, and stamp each selected material with its own `billed_invoice_id`/`billed_at`. Reject stale, billed, held, non-separate, cross-project, cross-client, or unauthorized IDs. The result returns the created invoice IDs/numbers grouped by currency.

If any group fails validation or persistence, create no drafts and leave all selected products unbilled. Draft deletion/unfinalization must release the linked products consistently with generated project invoices.

## Workstream C — Product cost context and per-row sale pricing

### C1. Cost lookup

Extend the canonical catalog picker/query result with read-only `cost` and `cost_currency` from `service_catalog`. Keep cost distinct from sale price and format it in its own currency. Do not copy cost into `project_materials`, use it in invoice totals, or permit edits from these surfaces.

Both of the existing UIs must show unit cost after product selection:

- `packages/projects/src/components/ProjectMaterialsDrawer.tsx`
- `packages/tickets/src/components/ticket/TicketMaterialsCard.tsx`

The two screens already share catalog/material service logic but duplicate their add-form rendering. Extract a small shared pricing summary/input component if package boundaries allow it cleanly; otherwise keep separate renderers with parity tests. Shared implementation is preferred, but identical behavior is the requirement.

### C2. Project sale-price override

In the project drawer, selecting a catalog currency prefills an editable unit sale-price input from `service_prices`. Quantity × overridden rate drives the displayed extended total. Adding the product stores that value in the existing `project_materials.rate` snapshot; it never updates `service_prices` or `service_catalog.default_rate`.

Add an edit action for each unbilled project-product row. It may change only the row's unit sale price and billing destination/link. Show catalog cost as context in the edit UI as well. Billed rows remain read-only and link to their invoice where available.

Ticket materials receive the read-only cost display only; their existing price behavior remains unchanged.

## Workstream D — Zero-dollar product-only phases

The server schema already accepts non-negative fixed amounts, but `ScheduleEntryDialog.tsx` rejects zero. Change amount-mode validation and copy to allow `0.00`; percentage entries must remain greater than zero. A zero-dollar add-on cannot increase the project total and should not show/enable the add-on checkbox.

Approval continues to freeze a zero-dollar amount normally. Invoice generation adds a targeted guard:

- A selected zero-dollar schedule entry may generate an invoice when at least one eligible product is assigned to that entry.
- If the selected entry would produce no product charge and no other non-zero billable content, block generation with a clear message explaining that a product-only phase needs at least one billable assigned product.
- A valid product-only invoice contains only the product lines. Transition and link the zero-dollar schedule entry to that invoice internally for project history without rendering a `$0.00` milestone line to the customer. The lifecycle must support an invoiced schedule entry whose `invoice_id` is set but whose `invoice_charge_id` is null. Do not create an empty zero-dollar draft.

The guard belongs in the server generation path so **Approve and invoice now**, the project-level generate action, and future callers behave consistently.

## Workstream E — Resolve under-allocation by recalculating the project total

When the fixed-price schedule footer has a positive delta (the schedule is under-allocated), add an action labeled with the concrete result, for example **Set project total to $8,500.00**.

Open a confirmation dialog showing:

- current project total,
- current non-canceled schedule sum,
- resulting project total, and
- a warning that editable percentage entries will become fixed-dollar entries so the displayed amounts do not move.

Add a transactional server action that locks the billing config and its entries, recomputes the same amounts shown by `computeEntryAmounts`, and then:

1. leaves frozen approved/invoiced entries unchanged,
2. converts active unfrozen percentage entries (pending, ready, or held) to their currently displayed fixed amounts,
3. leaves canceled entries out of the calculation,
4. sets `total_price` to the sum of the preserved active dollar amounts, and
5. returns the updated config, entries, and zero-delta rollup.

Reuse existing project-billing mutation permissions, tenant scoping, frozen-sum guards, revalidation, and update events. Recheck the delta in the transaction and reject a stale request rather than applying a total calculated from old rows. This action is offered for under-allocation only; the existing over-allocation warning remains unchanged.

## Workstream F — Calculated project-task Actual Hours

### F1. Definition

`project_tasks.actual_hours` remains a persisted minute total for compatibility, but it becomes derived and read-only:

- sum elapsed `end_time - start_time` for every linked `time_entries` row whose `work_item_type = 'project_task'`,
- include billable and non-billable entries,
- include draft, pending, changes-requested, submitted, approved, and other approval states immediately,
- clamp malformed negative durations to zero and round consistently to whole minutes, and
- return zero when no linked entries exist.

Do not use `billable_duration`; billing policy must not change actual effort.

### F2. Central recalculation helper and mutation coverage

Replace the three duplicated `SUM(billable_duration)` blocks in `packages/scheduling/src/actions/timeEntryCrudActions.ts` with one tenant-scoped helper that calculates elapsed minutes and updates the project task inside the same transaction as the time-entry mutation. When an update moves an entry between work items, recalculate both the old and new project tasks.

Audit every production time-entry insert/update/delete path and call the same helper where elapsed time or work-item linkage can change, including at minimum:

- scheduling time-entry CRUD,
- REST `TimeSheetService` create/update/delete paths,
- inbound time-entry creation, and
- Microsoft Teams time-entry creation/update paths.

Approval-only changes need no recalculation because approval state does not affect the total. Prefer routing bypass paths through a canonical time-entry mutation service where feasible; otherwise add explicit helper calls and contract tests so new direct writes are conspicuous.

### F3. Remove manual writes and repair existing data

- Render Actual Hours as read-only in task forms and inline task lists; keep Estimated Hours editable.
- Remove `actual_hours` from project-task create/update mutation payloads and API write schemas. Keep it in read schemas and exports.
- CSV/import paths should ignore a supplied Actual Hours value with an explicit warning that the field is derived from time entries; templates should stop soliciting it.
- New/copied tasks start at zero, not a copied manual value.
- Add a tenant-safe backfill migration that recomputes all existing project-task totals from linked time-entry timestamps. Ensure the SQL groups and joins on tenant as required for Citus.

## Workstream G — UX, permissions, and localization

- Use the existing `project:update` permission for project-product edits/destination changes and require the existing billing-create permission for invoice creation. Read-only cost follows the parent ticket/project read access.
- Add genuine English keys under the existing project, ticket, and billing namespaces, then update supported locales and pseudo-locales according to repository i18n conventions.
- Give all new controls stable IDs/data-automation IDs.
- Show actionable inline errors for invalid destination/currency combinations, stale product selections, empty product-only phases, and schedule-entry fallback to On hold.
- Keep invoice creation results navigable: one created draft opens directly; multiple drafts produce links grouped by currency.

## Data and lifecycle invariants

1. One invoice has exactly one currency.
2. One project product can be linked to at most one invoice and, while unbilled, at most one billing schedule entry.
3. A product is marked billed only when its invoice charge is persisted in the same transaction.
4. Billed product rate/destination/linkage is immutable through project-product actions.
5. A schedule entry cannot be deleted while linked products still target it; the application first moves those products to On hold in the same transaction.
6. Project completion changes eligibility but never creates or finalizes an invoice automatically.
7. Actual Hours is a function of linked time-entry timestamps, not billing duration or approval status.

## Test Plan

### Database-backed integration tests

1. Migration/backfill: existing project materials receive `next_project_invoice`; invalid destination/link combinations fail; tenant-scoped schedule links work on the migrated schema.
2. Project invoice selection: seed all five destinations and assert only next-invoice, matching-schedule, and eligible completion rows are charged for the applicable run; assert exact selected IDs are marked billed.
3. Currency enforcement: mismatched rows cannot target project/schedule billing and are not silently consumed by a project invoice.
4. Separate product drafts: mixed USD/EUR selection creates exactly two draft invoices, each with only its selected rows and correct totals/taxes; deselected rows remain unbilled.
5. Atomic failure/guard: a stale or already-billed selected row creates no drafts and changes no material links.
6. Invoice lifecycle: deleting/unfinalizing a generated product draft restores only its linked products to unbilled.
7. Zero-dollar phase: approval succeeds; generation without assigned products fails; generation with an eligible assigned product succeeds, contains only product charges, and links the schedule entry internally without a zero-dollar invoice line.
8. Under-allocation recalculation: mixed fixed, percentage, frozen, held, and canceled entries preserve displayed active dollars, convert only editable percentages, update the total atomically, and finish with zero delta. A concurrent/stale change is rejected.
9. Actual Hours backfill/helper: pending non-billable and approved billable entries both count elapsed minutes; create, duration edit, reassignment, and delete recalculate the correct old/new tasks using real queries.

### Unit and component tests

- Eligibility matrix for destination × currency × project completion × selected schedule IDs.
- Project and ticket add forms show read-only cost in its own currency.
- Project sale price prefills from the selected catalog price, accepts a per-row override, calculates the extended total, and submits the overridden rate.
- Unbilled row editing and billed-row lockout.
- Schedule selection labels include phase/milestone context; canceled/deleted linkage yields On hold plus warning.
- Separate-invoice review defaults all rows selected, supports deselection, groups totals by currency, and previews the correct draft count.
- Zero-dollar fixed-amount validation accepts zero while percentage validation still rejects zero.
- Under-allocation footer action and confirmation preview; no action for a reconciled or over-allocated schedule.
- Actual Hours renders read-only in task form/list and task write schemas reject or strip manual values as specified.

### End-to-end smoke coverage

1. Add a same-currency project product, override its sale price, view cost, assign it to a zero-dollar phase, approve, generate, and verify the draft invoice line and billed link.
2. Add products in two foreign currencies, run the separate-product review, deselect one row, create grouped drafts, and verify draft navigation and remaining unbilled rows.
3. Complete a project and verify completion-targeted products become eligible without an invoice being created automatically.
4. Log pending non-billable time against a project task and verify Actual Hours updates immediately and cannot be edited manually.

## Suggested Implementation Sequence

1. **Schema/types and migrations:** product billing intent/link, constraints/indexes/backfill, Actual Hours backfill.
2. **Canonical domain services:** material update/eligibility, exact material charge provenance, Actual Hours recalculation helper.
3. **Project invoice integration:** destination filtering, exact billed-row updates, zero-dollar product-only guard, lifecycle release.
4. **Separate product drafts:** transactional grouped generation and review result contract.
5. **Schedule workflows:** cancellation/deletion fallback and under-allocation recalculation action.
6. **UI:** project/ticket cost, project price override, Invoice with controls, separate-invoice review, zero-dollar validation, allocation CTA, read-only Actual Hours.
7. **Localization and automated coverage:** DB integration first, then component tests and focused end-to-end smoke tests.

## Risks and implementation notes

- **Current broad material stamping is unsafe:** invoice generation currently marks all unbilled project materials in the invoice currency. Exact source IDs must be carried through persistence before destination options ship.
- **Citus:** every migration, backfill, FK, join, and update must include `tenant`; validate the composite FK and new indexes against the distributed test schema.
- **Concurrent billing:** preview state is advisory. Generation must lock/revalidate material rows and guarantee one material cannot enter two invoices.
- **Project completion:** the existing close transaction cancels pending/ready/approved schedule entries. Apply linked-product fallback before those state changes while allowing `project_completion` rows to become eligible from `projects.is_closed`.
- **Cost semantics:** display catalog cost as agreed. Do not silently substitute inventory moving-average cost; that would be a separate product decision.
- **Actual Hours bypasses:** several production integrations write `time_entries` directly. The implementation audit must cover those paths or consolidate them, otherwise the persisted total will remain vulnerable to drift.
- **Manual invoice editing:** product-only drafts need source-aware lifecycle handling so editing/deleting a charge cannot leave a material falsely billed. Prefer treating generated product lines as sourced/non-manual charges and guarding destructive edits consistently with generated project invoices.

## Acceptance Criteria

- MSP users can see and edit an unbilled project product's per-row sale price and choose any valid Invoice with destination.
- Same-currency products follow their chosen project/phase/completion timing; held and separate products never leak into those invoices.
- Mixed-currency separate products can be reviewed and generated as one draft per currency with selectable rows and no auto-finalization.
- Canceling/deleting a targeted schedule entry puts linked products On hold with a visible warning.
- A zero-dollar phase can be approved and can invoice assigned products, but cannot produce an empty zero-dollar invoice.
- An under-allocation warning offers a confirmed action that preserves displayed phase dollars and makes the project total equal the schedule sum.
- Project and ticket material add surfaces show read-only catalog unit cost; project product sale-price overrides remain row-local.
- Project-task Actual Hours is non-editable and immediately equals elapsed time from all linked entries, including pending and non-billable time.
- DB-backed tests prove tenant isolation, exact material-to-invoice linkage, migration/backfill correctness, transactional failure behavior, and Actual Hours recalculation.
- No item from the disregarded second handwritten page is implemented as part of this plan.
