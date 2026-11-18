# Plan: Recurring tickets on ticket templates (first draft)

PSA alga-2026-0002502 follow-up. There is no Design Session plan for this card; this document is the whole plan.
The draft is **stacked on #3728** (ticket templates, still open). Restack onto main after #3728 merges.

## 1. Goal

A recurring ticket definition stops carrying its own copy of the ticket fields and points live at a shared
`ticket_templates` row.

- Template = **what**: title (with tokens), description, board, category/subcategory, priority, ITIL impact/urgency,
  tags, owned checklist items, custom fields.
- Definition = **when, for whom, how dispatched**: schedule, clients, status and assignment, plus `overrides` (jsonb).
- One cascade: template -> definition overrides -> client overrides.
- One `instantiateTicketTemplate` (built on `createTicketWithSideEffects`) used by the generator. `addTicket`'s
  from-template branch shares its helpers (`loadTemplateForInstantiation`, `templateTicketProvenance`,
  `applyCreatedFromTemplateEffects`). `createTicketWithSideEffects` is widened (see R9).

## 2. Decisions

- **R1** The template is shared and referenced live, never copied.
- **R2** Permission boundary stays: `ticket_template:update` edits content; `recurring_ticket:update` edits schedule,
  dispatch and overrides. Picking a template needs `ticket_template:read`.
- **R3** Deleting a template used by any non-archived definition (active or paused) is refused with an error listing the
  schedules. Enforced in `deleteTicketTemplate` and by the tenant-composite FK `ON DELETE RESTRICT`.
- **R4** Deactivating a template only means "do not offer for manual use". The generator never checks `is_active`.
  The editor shows "Used by N schedules".
- **R5** `offer_for_manual_use` (migrated templates get false). Pickers require `is_active AND offer_for_manual_use`.
  The admin list shows a "Scheduled only" badge.
- **R6** Checklists become snapshots (items copied from the checklist template at migration time). Items keep
  `checklist_template_id`, so the replacement rule still prevents doubling with board auto-apply.
- **R7** Description is written as `JSON.stringify(definition.description)`, as the legacy generator did.
- **R8** Tokens `{{client}}`, `{{due_date}}`, `{{month}}`, `{{year}}`, `{{contact}}` (`lib/ticketTitleTokens.ts`). Missing
  context renders empty with whitespace collapsed. Quick Add renders the client, contact and due date
  (a local `YYYY-MM-DD`), and re-renders when any of them changes, only while the title is untouched.
- **R9** `instantiateTicketTemplate` shape: resolve cascade -> check references on the effective values -> create.
  The create layer is widened rather than composed around: `createTicketWithSideEffects` takes optional
  `checklistItems` (owned items with an optional `checklist_template_id`, applied with the replacement rule by
  `insertChecklistItemsReplacingTemplates`, now in `shared/lib/ticketChecklists/insertItems.ts`) and `fromTemplate`
  (writes `TICKET_CREATED_FROM_TEMPLATE`). `addTicket` cannot use that function wholesale, so it calls the same
  exported `applyCreatedFromTemplateEffects`.
- **R9a** Checklist activity. The legacy generator wrote a `TICKET_CHECKLIST_TEMPLATE_APPLIED` row via
  `applyChecklistTemplateToTicket` (details `{template_name, items_added}`, entity `CHECKLIST_ITEM`). The new path
  writes the same row, same shape, once per carried checklist template whose items were inserted, unless board
  auto-apply already applied that template (it wrote its own row), so a ticket never gets two. Equivalence test #1
  compares the event types per ticket against the legacy set; #3/#3b cover the no-doubling and no-auto-apply cases.
- **R10** Generated tickets carry `created_from_template_id` and the `TICKET_CREATED_FROM_TEMPLATE` activity. Origin
  stays `recurring`; the ticket header shows both badges.
- Status is validated against the **effective** board. A mismatch fails the occurrence with
  "Status X does not belong to board Y; edit the schedule". A missing or dangling template also fails the occurrence.
- Unchanged: idempotency ledger, window, missed/failed/skipped semantics, suppression.

## 3. Migrations

- **A (additive, committed)** `20261017120000_add_recurring_ticket_template_link.cjs`: `ticket_templates.offer_for_manual_use`,
  `recurring_ticket_definitions.ticket_template_id` (nullable) and `overrides`, index, tenant-composite FK
  (added after distribution, guarded for co-location; a NULL member is not enforced). Relaxes NOT NULL on the legacy
  content columns the app no longer writes.
- **B (data, committed)** `20261017120100_backfill_recurring_ticket_templates.cjs`: per tenant, in batches, create a template
  per definition (name deduped among active names, mapping in `utils/recurringTemplateMapping.cjs`), copy checklist
  items, link. Idempotent. Down restores empty legacy columns from the template and removes migrated templates.
- **C (NOT committed; the next step)**: after #3728 merged and the equivalence test passed on a prod-shaped clone, make
  `ticket_template_id` NOT NULL and drop the legacy columns (`title_template`, `description`, `board_id`, `priority_id`,
  `category_id`, `subcategory_id`, `tags`, `checklist_template_id`). Legacy columns and data stay until then.

## 4. Tests

Unit: cascade (`effectiveFields`), token rendering and untouched-title rule, definition input schema, token validation
(`ticketTemplateSchema`), migration B mapping and name dedupe.

Integration (`recurringTicketTemplates.integration.test.ts` unless noted):
1. equivalence: legacy shape -> A, B -> generate, same fields, `created_from_template_id` set
2. template edit affects only the next occurrence
3. checklist replacement gives exactly one set
4. R3: refused when active or paused, archived does not block, raw FK blocks a delete
5. R4: deactivated template still generates
6. R5: picker/for-create filters, admin list keeps it
7. cascade; status not on effective board -> `failed`; missing template -> `failed`
8. permissions (template update vs schedule update vs template read)
9. ITIL values and provenance activity on generated tickets
10. existing suites updated: `recurringTicketGenerator`, `recurringTicketActions`, `ticketTemplates` (down test rolls back A first)
11. migration B idempotent re-run and down; migration A idempotent and down/up
