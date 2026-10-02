# Ticket time → project billing attribution (alga-2026-0002622)

Time logged on a ticket that is linked to a project never counts as project time. The
project's Budget vs Actual card reads 0 hours, project-scoped invoices skip it, and on a
fixed-price project it is still billed hourly on top of the fee. Regular client-level
invoice runs do pick it up through `tickets.client_id`, so the money is not lost, it is
just never project money.

## What is confirmed in code

| Site | Finding |
|---|---|
| `packages/billing/src/lib/billing/billingEngine.ts:2470` and `:5034` | Both time-entry loaders LEFT JOIN `project_ticket_links` and never read it. `projects` is reached only via `project_tasks → project_phases`, which cannot match a ticket id. The join landed in 31ebda4feb (non-contract due-work, March) and the wiring was never finished. |
| engine `projectTarget` filter, fixed-price exclusion (`~2531`, `~5177`), T&M tag (`~2725`) | All key off `projects.project_id` / `entry.project_id`, so a correct join lights them up with no further change. |
| `packages/billing/src/actions/projectBillingConfigActions.ts:278` | Budget actuals inner-join `project_tasks` with `work_item_type = 'project_task'`. Ticket hours are invisible. |
| `packages/billing/src/actions/profitabilityReportActions.ts` `~382`, `~593` | Labor facts and `is_fixed_project_time_charge` make the same assumption. Ticket time rolls up to the client, never to the project. |
| `packages/clients/src/actions/clientPulseActions.ts:700` | Same. |
| `project_ticket_links` schema | PK `(tenant, link_id)` only. Model guard is per `(project, phase, task, ticket)`; REST `ProjectService.createTicketLink` has no guard; workflow runtime inserts with a swallowed error. One ticket can carry several links, so a naive join multiplies time rows. |
| Double billing | Already structurally impossible. Loaders filter `invoiced = false`; `invoiceService.ts:280` updates only where still false and throws on row count ≠ 1; `invoice_time_entries.entry_id` is unique. Nothing here changes that. |
| "Project Billing" tab | Is the milestone/deposit review queue (`listReadyScheduleEntries`). Approved T&M time never appears there by design. Empty-state copy does not say so. |

The REST link schema (`server/src/lib/api/schemas/project.ts:260`) declares `link_type` and
`notes`, which the table does not have. Not this ticket's bug, but the API path gets touched
here, so check it before relying on it.

## Decisions

| # | Decision | Why |
|---|---|---|
| a | **The link carries the billing choice**: `project_ticket_links.bill_under_project boolean not null default true`. | Linking a ticket to a project task almost always means project work; reference-only links are the exception and should carry the click. Keeps ticket billing flexible per ticket without touching time entries, timesheets, mobile or the v1 time API. |
| b | **Backfill existing links to true.** | Backfilling false leaves the reporting customer with the bug until they edit every link. Attribution only changes billing on projects that have a `project_billing_configs` row (July 2026 feature), so the blast radius is tenants who set up project billing and expect exactly this. Release note required. |
| c | **Opt-out, never implicit rerouting.** Flag off ⇒ today's behavior: billed hourly at client level, not counted toward the project. | A link can be made from the task card, create-task-from-ticket, REST, and workflow auto-link. None of those should silently move money. |
| d | **Ambiguity attributes nothing.** A ticket with flagged links into more than one distinct project is left unattributed and logged. Several tasks in one project is fine. | Guarantees the join can never fan out a time entry into N rows. |
| e | **Invoiced entries are never touched** by flipping the flag either way. | Guarantee already exists; the tests assert it so nobody loosens it later. |
| f | Entry-level override (`time_entries.project_id`) is **deferred** until a customer asks. | Would mirror `contract_line_id` but touches timesheet, mobile and API for a case nobody has reported. |
| g | **A cap in another currency is dormant, never converted.** When `project_billing_configs.currency` is not the currency the invoice bills in, the budget cap is not applied, the run warns the biller, and the project billing cards name the client's currency. | Found in production: a CHF tenant, a client billing ARS and a project cap still counted in USD. The config currency is pinned to the client's on every write, but a client can change currency afterwards. Caps are minor units with no exchange rate anywhere in the engine, so comparing them across currencies writes work down against a meaningless number — exactly the silent money move this ticket is about, and now reachable by more charges because ticket time joins the project. Re-entering the cap on the T&M panel re-pins the project to the client's currency. |
| h | **A client's own currency outranks its contracts** when pinning a project's billing currency. | "Pinned to the client's currency" in (g) was not actually true: both resolvers took any single active contract's `currency_code` first and only fell back to `clients.default_currency_code`. A client billing CHF with one legacy USD contract got every new project pinned to USD — and invisibly, because the stale-currency notice compares the stored currency against a fresh resolution, which agreed. Contract currency is now inference of last resort, for clients that never set one; quotes already resolve in this order (DD-2/F-2). |
| i | **The cap's mismatch is measured against the currency the invoice bills in, and that currency can be re-pinned.** One rule (`resolveInvoiceCurrency`: a single contract-line currency, else the client's own) answers it for the engine, the due-work listing and the project billing cards; a project may be denominated in any currency its client is actually invoiced in. | (h) left the two sides disagreeing in the *unsafe* direction. The engine bills a contract-backed invoice in the contract's currency — it must, since a contract line's rates are denominated there — so a CHF client with a legacy USD contract got a cap pinned CHF and an invoice in USD: `capAppliesToInvoiceCurrency` false, cap applied by neither the engine nor persistence, where before (h) it bit. The run warning's own advice ("set the project's billing currency to USD and re-enter the cap") was rejected by the config validation, and the cards compared against the client's currency, so they agreed and stayed silent. A hard cap that silently stops limiting billing is exactly the money move this ticket is about. New configs still pin to the client's own currency per (h) — the surprise in the production report — but the mismatch is now named on the cards and the re-pin the warning asks for is accepted. Separately, the due-work listing was being handed the client's currency as the answer while generation resolved it from contract lines, so a preview could write a cap down that the invoice would not. |

## Design

### Schema

Migration `server/migrations/<ts>_add_bill_under_project_to_project_ticket_links.cjs`:

* `ALTER TABLE project_ticket_links ADD COLUMN bill_under_project boolean NOT NULL DEFAULT true`.
  Default handles the backfill. Citus: plain `ADD COLUMN ... DEFAULT` on a distributed table is
  metadata-only; keep `exports.config = { transaction: false }` consistent with the index
  migration next to it.
* Index `(tenant, ticket_id) WHERE bill_under_project` to serve the resolver below.
* `IProjectTicketLink` and `IProjectTicketLinkWithDetails` gain `bill_under_project: boolean`.

### Project resolver (one place, reused everywhere)

A small SQL fragment in `packages/billing/src/lib/billing/` (next to the engine) that yields,
per ticket, the single billable project or nothing:

```sql
LEFT JOIN (
  SELECT tenant, ticket_id,
         MIN(project_id::text)::uuid AS project_id,
         COUNT(DISTINCT project_id)   AS project_count
  FROM project_ticket_links
  WHERE bill_under_project
  GROUP BY tenant, ticket_id
) ticket_project
  ON ticket_project.tenant = time_entries.tenant
 AND ticket_project.ticket_id = time_entries.work_item_id
 AND time_entries.work_item_type = 'ticket'
 AND ticket_project.project_count = 1
```

Then every consumer joins `projects` on
`COALESCE(project_phases.project_id, ticket_project.project_id)`.

Grouped by the distribution column, so Citus pushes it down. Verify on the local Citus stack
before merging; fall back to a `LEFT JOIN LATERAL ... LIMIT 1` with a `NOT EXISTS` second-project
guard if the planner rejects the derived table inside the engine's pinned transaction.

Ambiguous tickets (`project_count > 1`) are surfaced once per run through the engine's existing
warning channel so the biller can fix the links.

### Billing engine

* Replace the dead `project_ticket_links` join in both loaders with the resolver and change the
  `projects` join predicate to the COALESCE. `projectTarget`, fixed-price exclusion and the T&M
  tag need no edits. `project_phase_id` stays what it is (null for ticket time); add
  `ticket_project.project_id` as a selected column only if the snapshot builder needs it.
* The hourly loader's work-item-type guard (`~5097`) already admits `ticket` rows, nothing to do.

### Actuals and reports

* `getProjectEconomics` (`projectBillingConfigActions.ts:249`): replace the inner join chain with
  `LEFT JOIN project_tasks/phases` plus the resolver, filter on
  `COALESCE(phase.project_id, ticket_project.project_id) = ?`.
* `profitabilityReportActions.ts` labor facts and `is_fixed_project_time_charge`: same
  substitution. Client attribution for ticket time stays `t.client_id`; only the project rollup
  changes.
* `clientPulseActions.ts:700`: same.

### Link creation paths

| Path | Change |
|---|---|
| `ProjectTaskModel.addTaskTicketLink` / `addTicketLinkAction` | Accept `billUnderProject?: boolean` (default true). Add `setTicketLinkBilling(linkId, bool)` action. |
| `ProjectService.createTicketLink` (REST `POST /api/v1/projects/{id}/tickets`) | Add `bill_under_project` to `createProjectTicketLinkSchema` (optional, default true) and to the response schema. Add the same duplicate guard the model has. Strip `link_type`/`notes` if the insert turns out to fail on them. |
| Workflow `projects.ts:1344` (create task with `link_ticket_id`) and `:2554` (copy links) | Pass the flag through; copy preserves the source link's value. Expose `bill_under_project` as an optional workflow input defaulting to true. |
| Ticket deletion (`deleteTicketChildRecords.ts`) | No change; links are deleted with the ticket as today. |

### UI

* `TaskTicketLinks.tsx` link dialog: pre-checked checkbox "Bill this ticket's time as project
  time" (`id="bill-under-project-checkbox"`). Linked-tickets rows show a small badge when the
  flag is off and expose a toggle; flipping it calls `setTicketLinkBilling`.
* `TicketLinkedTasksBadge.tsx` (ticket side): show the same state so a tech on the ticket can see
  where its time will bill.
* `ProjectBillingReviewTab.tsx:500` empty state: add one sentence that approved T&M time is not
  queued here; it bills through the normal invoice run or the project's "Generate project
  invoice" button.
* All strings through `t()` in both `msp/projects` and `msp/billing` namespaces, en + glossaried
  locales.

### Release note

"Time logged on tickets linked to a project now bills as project time: it appears on
project-scoped invoices, counts toward T&M caps, and is covered by a fixed-price fee instead of
being billed hourly. Already-invoiced time is unaffected. Untick 'Bill this ticket's time as
project time' on a link to keep billing that ticket at the client level."

"A budget cap is counted in the project's own billing currency. If that is not the currency the
project's invoices bill in — which happens when a client's currency changed after the project was
set up, or when the client is invoiced through a contract in another currency — the cap is not
applied, and the invoice run says so. The project's billing tab names both currencies; re-entering
the cap there moves the project to the currency its invoices use."

Reporting moves with it, and reporting looks backwards as well as forwards: project budget
actuals, profitability and the client WIP rollup now count linked-ticket hours against the
project for past periods too, so a fixed-price project's historical ticket time reads as
covered by the fee (revenue on the fee, not on the hours) rather than as separate hourly
revenue. Client-level attribution of that time is unchanged — only the project rollup moves.

### PR scope

The branch carries **two** billing behavior changes: ticket-time attribution (work items 1–8)
and the cross-currency cap guard of decision (g). They ship together because attribution is what
makes caps reachable for far more charges, but the cap guard is separable — it stands on its own
against today's `main`. The PR body must name both so a reviewer reading only the ticket title is
not surprised by cap behavior in the diff.

## Work items, in order

1. Migration + interface fields + `tenantTableMetadata` unchanged (still tenant-scoped).
2. Resolver fragment + both engine loaders. Run the existing `projectBillingEngine.test.ts` and
   the golden T021 scenario byte-for-byte: no project links ⇒ identical output.
3. Engine tests (below).
4. Budget actuals SQL + static contract test.
5. Profitability + client pulse (can be its own PR if the first one is already large).
6. Model/action/REST/workflow flag plumbing + duplicate guard on REST.
7. UI: link dialog checkbox, row toggle, ticket-side badge, empty-state hint, i18n.
8. Citus verification on the local stack; release note; reply on the ticket.

## Tests

Engine unit (`server/src/test/unit/billing/projectBillingEngine.test.ts`, T013 style, ticket
time entry linked via `project_ticket_links`):

* T&M standalone run includes the ticket entry with the project tag.
* Fixed-price standalone run excludes it; a plain client run also excludes it.
* Flag off ⇒ entry absent from the project run, present in the client run, untagged.
* Ticket flagged into two projects ⇒ unattributed, one warning, no duplicate rows.
* Ticket linked to two tasks in the same project ⇒ attributed once.
* Entry already `invoiced = true`, link added afterwards ⇒ untouched by both runs.
* Golden T021: unchanged.

Static contract tests (pattern: `profitabilityReportActions.static.test.ts`): budget actuals,
profitability labor facts and client pulse all contain the resolver fragment.

Integration (`server/src/test/integration/billing/projectBillingSchema.integration.test.ts`
or a sibling): migration applies, column default true, backfilled rows true, flagged index
present; REST create with and without the flag; duplicate REST link rejected.

UI contract test next to `projects-i18n-audit.test.ts` for the new strings.

## Open questions

* Should workflow auto-links (create task from ticket inside an automation) default to true like
  everything else, or false because an automation never asked the biller? Plan says true for
  consistency; flip in one place if review disagrees.
* `MIN(project_id)` is only there to make the grouped row well-formed when `project_count = 1`.
  If review prefers an explicit "oldest link wins", use `LATERAL ... ORDER BY created_at LIMIT 1`
  from the start.
