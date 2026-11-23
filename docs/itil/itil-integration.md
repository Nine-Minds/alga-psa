# ITIL ticketing in AlgaPSA

ITIL is a property of a **board**, not of a tenant. A tenant can run any number of ITIL boards
beside its own boards, and each ITIL board behaves the same way as the first one: the same priority
family, its own copy of the standard category set, the same Impact × Urgency rule and, on AlgaPSA,
the same SLA policy.

This document describes what is built. The rules are stated once here and implemented once, in
`shared/lib/tickets/boardFieldRules.ts`; every screen, action, REST route, workflow and integration
goes through that module, and `scripts/guard-ticket-board-field-rules.mjs` fails the build when
something new does not.

## Contents

- [The rules](#the-rules)
- [Data model](#data-model)
- [Priorities and the Impact × Urgency matrix](#priorities-and-the-impact--urgency-matrix)
- [Categories](#categories)
- [Board lifecycle](#board-lifecycle)
- [SLA](#sla)
- [Where the code lives](#where-the-code-lives)
- [Operating notes](#operating-notes)

## The rules

**R1 — a board has one kind.** `boards.category_type` and `boards.priority_type` are both
`custom` or both `itil`. The pair is checked when a board is created and whenever either column
changes. Boards created before this rule that hold a mixed pair keep working and can still be
edited in every other respect; they cannot be produced again.

**R2 — a category belongs to a board.** A category is valid for a ticket when
`categories.board_id` is the ticket's board, and a subcategory must be a child of the ticket's
category. This is the same rule on ITIL and non-ITIL boards.

- Each ITIL board owns a copy of the standard set, and every copy carries the
  `standard_categories` row it came from in `categories.standard_category_id`.
- While its board is ITIL, a standard row cannot be renamed, re-parented, moved or deleted, and no
  other category can be added to that board — from settings, REST, CSV import or a copy between
  boards.
- Categories that were attached to an ITIL board and are not standard rows stay attached and are
  listed.
- A write that supplies a standard category belonging to *another* board is translated to this
  board's copy of the same standard category before it is checked, so an integration or workflow
  holding one board's id keeps working on every ITIL board.
- A category with no board is offered by no picker and is not accepted as a new value. A ticket
  that already holds one keeps it and stays editable.

**R3 — priorities come in two families.** A ticket priority fits a board when
`priorities.is_from_itil_standard` matches the board's `priority_type`. Priorities are tenant-wide,
so both families exist side by side; the picker is what narrows them to the board. The flag and
`priorities.itil_priority_level` are set by ITIL seeding alone — no category or priority create or
update can set them.

**R4 — Impact × Urgency.** Only on a board with ITIL priorities:

| The write supplies | Result |
|---|---|
| Impact and Urgency | The priority is the matrix result, found by `itil_priority_level`. A supplied priority is ignored. |
| One of the two | Refused where a person sees the error; both dropped on automated paths. |
| A priority only, no assessment stored | Accepted if it is an ITIL priority. Impact and Urgency stay empty ("Not assessed"). |
| A priority only, an assessment stored | Accepted if it is an ITIL priority. Impact and Urgency are cleared to "Not assessed". |

On a board with the tenant's own priorities, Impact and Urgency are not stored.

**R5 — only what a change touches.** An update checks the priority when the priority or the board
changes, and the category when the category, subcategory or board changes. A ticket that already
breaks R2 or R3 still saves a change to its title, status, assignee or description.

**R6 — refuse or fall back.** A path with a person or an API caller who sees the error refuses a
value that does not fit; a path with nobody to see it never drops the ticket.

| Refuses with a field error | Falls back |
|---|---|
| MSP create and update, create from asset | Inbound email |
| Client portal create | RMM and Huntress alert tickets |
| REST `v1` create, update and create-from-asset (and mobile, MCP and chat through it) | Telephony auto-ticket |
| CSV import, per row | Contract renewal ticket |
| Teams message action and guest intake, manual telephony ticket | Workflow `tickets.create` |
| Workflow `tickets.update_fields`, `assets.create_maintenance_ticket` | Inbound webhook create |
| Inbound webhook update | Service request provider |
| Templates and recurring schedules | Data-migration import |
| Bundle sync, the Activities inline picker, co-managed edit | |

Falling back means: the configured priority if it fits the board; otherwise the board's default
priority (R7); otherwise the configured priority unchanged. A category that does not belong to the
board and cannot be translated is dropped.

**R7 — a board's default priority.** `boards.default_priority_id` when it fits the board;
otherwise the level-3 ITIL priority on an ITIL board, or the lowest-ordered ticket priority of the
tenant's own on other boards; otherwise none.

**R8 — SLA.** Creating a board with ITIL priorities on an AlgaPSA tenant creates the "ITIL
Standard" policy if the tenant has none, adds any missing targets for the ITIL priorities, and
assigns the policy to the new board unless the board already has one. Nothing else assigns a
policy — a change of board kind does not. AlgaDesk tenants are skipped.

**R9 — matching tickets by category across boards.** The ticket list filter and the client portal
filter list every category of the tenant on every tab. A standard category appears once there, and
choosing it matches that standard category on every board in scope. The match lives in the
predicate engine, so ticket list filters, saved view filters and checklist apply rules all behave
the same way, and a stored value holding one board's copy keeps matching the tickets it matched
before.

## Data model

| Table | Column | What it holds |
|---|---|---|
| `boards` | `category_type`, `priority_type` | `custom` or `itil`; equal to each other (R1). |
| `boards` | `default_priority_id` | The board's default priority; released when the priority is deleted. |
| `boards` | `sla_policy_id` | The policy new tickets on the board start with. |
| `categories` | `board_id` | The board the category belongs to (R2). `NULL` means no board: listed nowhere, kept where held. |
| `categories` | `parent_category` | The parent of a subcategory. |
| `categories` | `standard_category_id` | The `standard_categories` row this is a copy of, or `NULL`. Unique per `(tenant, board_id, standard_category_id)`. |
| `categories` | `is_from_itil_standard` | Kept equal to "has a standard link". |
| `standard_categories` | — | The 35 standard rows (5 parents, 30 children) every ITIL board is seeded from. |
| `priorities` | `is_from_itil_standard` | The family (R3). |
| `priorities` | `itil_priority_level` | 1 critical … 5 planning, on ITIL rows only. |
| `priorities` | `item_type` | `ticket` rows are the ones these rules apply to. |
| `tickets` | `itil_impact`, `itil_urgency` | The assessment, 1–5 each; empty means "Not assessed". |
| `tickets` | `priority_id`, `category_id`, `subcategory_id`, `board_id` | Written only through the shared rules. |
| `sla_policies` | `is_itil_standard` | Marks the auto-created policy; at most one per tenant. |
| `sla_policy_targets` | `priority_id` | One target per ITIL priority. |
| `sla_notification_thresholds` | `threshold_percent` | The warning and breach points of a target. |
| `itil_category_remap` | `old_category_id`, `new_category_id` | The category migration's journal, kept afterwards. |

`tickets.itil_priority_level` still exists and is no longer written or accepted from a client: the
level is read from the ticket's priority row.

## Priorities and the Impact × Urgency matrix

The five ITIL priorities are seeded per tenant with their level in `itil_priority_level`. The
matrix lives in `shared/lib/itil/priorityMatrix.ts` and is pure — no database, no tenant — so a
client component and a workflow can both call `calculateItilPriority()`.

| Impact \ Urgency | 1 High | 2 Medium-High | 3 Medium | 4 Medium-Low | 5 Low |
|---|---|---|---|---|---|
| **1 High** | Critical | High | High | Medium | Medium |
| **2 Medium-High** | High | High | Medium | Medium | Low |
| **3 Medium** | High | Medium | Medium | Low | Low |
| **4 Medium-Low** | Medium | Medium | Low | Low | Planning |
| **5 Low** | Medium | Low | Low | Planning | Planning |

Every priority picker — the ticket form, the quick-add dialogs, the ticket list bulk actions, the
Activities inline picker, inbound email defaults, templates, recurring schedules, CSV import and
`GET /api/v1/tickets/priorities?board_id=…` — lists through `listPrioritiesForBoard()`, so no
picker offers a value the server then refuses. A ticket's current priority stays visible even when
it no longer fits, so an existing ticket can still be saved (R5).

ITIL priorities cannot be deleted while any board of the tenant has `priority_type = 'itil'`.
Once the last such board is gone they become deletable, with a note in
**Settings → Ticketing → Priorities** explaining the change.

## Categories

An ITIL board is seeded with its own copy of the 35 standard rows when it is created, by
`ItilStandardsService.copyItilCategoriesToTenant()`. Creating a second ITIL board changes no
category on any other board.

Lists come from `listCategoriesForBoard()`, which narrows by `board_id` and orders parents before
their children. A write that names another board's copy of a standard category is translated by
`translateStandardCategoryForBoard()`, so the ticket stores its own board's copy.

### The per-board migration

`server/migrations/20261122120000_itil_categories_per_board.cjs` moves a tenant from "one flagged
set somewhere" to "a set per ITIL board". It is idempotent, runs per tenant and is Citus-safe, and
it journals everything it does in `itil_category_remap` so `down()` can undo it:

1. Add `standard_category_id` and create the journal table.
2. Map every flagged category to its standard row by name and parent name — the only name match,
   run once — wherever the row sits: on an ITIL board, on another board, or on none.
3. Give every ITIL board its own set: rows already on the board are linked in place and keep their
   ids, missing rows are inserted parents first, and a standard child whose parent sits elsewhere
   is re-parented to the board's own parent.
4. Re-point every reference an ITIL board holds to a mapped category that is not that board's own:
   tickets, templates, recurring definitions and their overrides, inbound ticket defaults, saved
   views, and the settings that hold a board and a category together.
5. Clear the flag and the link on mapped rows that are not on an ITIL board. They become ordinary
   categories, of their board if they have one. No row is deleted.
6. Add the unique index.

Settings that hold a category without a board — a workflow `tickets.update_fields` action, a
checklist rule with no board, a view across all boards — are not re-pointed. They keep working
through translation on write (R2) and standard-aware matching (R9).

## Board lifecycle

`createBoardCore()`, `updateBoardCore()` and `deleteBoardCore()` in
`packages/tickets/src/services/boardLifecycle.ts` are the one implementation; the settings actions,
the REST `BoardService` and the onboarding wizard all call them, so a board created through
`POST /api/v1/boards` has the same statuses, categories, default priority and SLA assignment as one
created in settings. (The reference-data board import is the exception: importing the create back
into `packages/reference-data` would be a dependency cycle, so it applies R7 through the shared
rules module instead.)

Deleting the last ITIL board runs its cleanup before the board row is removed: categories of the
board are released, references that would block a priority delete
(`sla_policy_targets`, `boards.default_priority_id`, `inbound_ticket_defaults`) are cleared, and
the auto-created policy is retired once nothing points at it.

### Changing a board's kind

**Settings → Ticketing → Boards → Change board type** calls
`getBoardTypeSwitchSummary()` first: it reports how many open tickets and stored settings will no
longer fit, and what SLA policy the board will have afterwards. On confirmation,
`switchBoardType()` flips both kind columns together (R1) and seeds the standard categories when
the new kind is ITIL. It changes no ticket, inbound default, template, schedule or SLA assignment —
a board switched away from ITIL keeps an ITIL-only policy until an admin changes it, and the
confirmation says so.

## SLA

The defaults are in `shared/lib/sla/itilSlaDefaults.ts`:

| Level | Priority | Response | Resolution | 24×7 |
|---|---|---|---|---|
| 1 | Critical | 15 min | 1 h | yes |
| 2 | High | 30 min | 4 h | no |
| 3 | Medium | 1 h | 24 h | no |
| 4 | Low | 4 h | 72 h | no |
| 5 | Planning | 8 h | 1 week | no |

Each target is created with escalation points at 70%, 90% and 110% of the target time, and
notification thresholds at 50%, 75%, 90% (warning) and 100% (breach).

`configureItilSlaForBoard()` in `packages/sla/src/services/itilSlaService.ts` does the work:
create the policy if the tenant has none, top up missing targets, assign it to the board unless the
board already has a policy. `packages/tickets` reaches it through hooks registered at startup
(`registerSlaIntegration()`, asserted by `assertSlaIntegrationRegistered()`), because a Next build
gives startup code and server actions separate module instances; the hooks are held on `globalThis`
for that reason.

AlgaDesk tenants are skipped: they get the matrix, the priorities and the categories, but no policy
is created and no breach notification is emitted.

## Where the code lives

| File | What it is |
|---|---|
| `shared/lib/tickets/boardFieldRules.ts` | The rules: `listPrioritiesForBoard()`, `listCategoriesForBoard()`, `findBoardFieldProblems()`, `translateStandardCategoryForBoard()`, `defaultPriorityForBoard()`, `resolveTicketPriorityFields()`, `prepareTicketCreateFields()`, `prepareTicketFieldPatch()`. |
| `shared/lib/itil/priorityMatrix.ts` | The Impact × Urgency matrix and its labels. |
| `shared/lib/sla/itilSlaDefaults.ts` | Policy name, targets, escalation points, notification thresholds. |
| `shared/models/ticketModel.ts` | The create funnel: the rules are applied before the row is built. |
| `packages/tickets/src/services/boardLifecycle.ts` | Board create, update, delete and the type switch. |
| `packages/tickets/src/services/itilStandardsService.ts` | Seeding priorities and a board's category set. |
| `packages/tickets/src/lib/slaIntegrationHooks.ts` | The SLA hooks, held on `globalThis`. |
| `packages/sla/src/services/itilSlaService.ts` | Policy creation, target top-up, board assignment. |
| `server/migrations/20261122120000_itil_categories_per_board.cjs` | The per-board category migration and its reversal. |
| `scripts/guard-ticket-board-field-rules.mjs` | The build guard. |
| `scripts/reports/priority-board-mismatch.sql` | The read-only mismatch report. |

The superseded design document is kept at `docs/archive/ITIL_Integration_Plan.md`.

## Operating notes

### Finding rows that do not fit

```bash
psql "$DB_URL" -v ON_ERROR_STOP=1 -f scripts/reports/priority-board-mismatch.sql
```

The script runs inside a read-only transaction and prints one section per source — recurring
definitions, templates, open tickets — with one row per tenant that has a mismatch. The priority
sections compare families (R3); the category sections compare the category's board with the board
the row points at (R2), and count categories with no board apart.

### Common questions

**A picker offers nothing on an ITIL board.** The tenant has no ITIL priorities, or the board is
mixed (R1): check `boards.category_type` and `boards.priority_type`.

**A write is refused with "does not belong to this board".** The category belongs to another board
and is not a standard row, so it cannot be translated (R2). Pick the board's own category.

**Inbound email uses a different priority than the configured one.** Email falls back (R6): the
configured priority does not fit the board, so the board's default is used. The inbound defaults
form shows a warning on the saved row until it is changed.

**A ticket has no SLA due date.** Its board has no policy — most often a board switched away from
ITIL, or an AlgaDesk tenant, where no policy is created at all.

**A new file reads `priorities` or `categories` and CI fails.** That is
`scripts/guard-ticket-board-field-rules.mjs`. List through the shared rules module; if the file
genuinely owns those rows, add it to the allow-list in the same change.
