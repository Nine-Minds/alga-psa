# PRD — ITIL boards: one set of rules

- Slug: `itil-remediation`
- Date: `2026-11-21`
- Status: Draft (revised after review, 2026-11-21; all decisions made, 2026-11-22)

## Summary

A ticket board is either ITIL or not. An ITIL board uses the five ITIL priorities (chosen through Impact × Urgency) and the standard ITIL category set; every other board uses the tenant's own priorities and categories. Today that rule is enforced in a few places and ignored in most, the standard categories only work on the first ITIL board of a tenant, and board setup behaves differently depending on which entry point created the board.

This plan puts the rules in one shared place, makes every screen that offers a priority or category and every path that writes one use them, gives each ITIL board its own categories, makes board setup identical on the web and the REST API, and adds tests and a build guard so the rules stay applied.

## Problem

1. **Tickets get a priority that does not belong to their board.** The priority/board check from PR #3880 (`packages/tickets/src/lib/ticketFieldReferences.ts`) runs on MSP create and update, REST create and update, and templates and recurring tickets. It does not run on client portal create, inbound email, CSV import, service requests, workflow actions, Teams, inbound webhooks, bundle sync, RMM and Huntress alert tickets, telephony, renewal tickets, or the Activities inline priority picker. Several settings screens that feed those paths (inbound email defaults, workflow designer, Huntress, inbound webhooks, service requests) offer priorities of both kinds.
2. **ITIL categories only work on the first ITIL board.** `ItilStandardsService.copyItilCategoriesToTenant` creates one set per tenant, stamped with the `board_id` of the first board that enabled ITIL. The main ticket form lists them by flag, but nine other pickers filter by `board_id` alone and come back empty on any other ITIL board, and the validator at `ticketFieldReferences.ts:211` rejects the category the picker just offered, so templates and recurring tickets cannot save one there.
3. **The standard set is matched by name.** The copy step looks up existing rows by name across the whole tenant and flags whatever it finds, so a tenant's own "Hardware" category on another board becomes an ITIL row with ITIL children hung under it. The Impact × Urgency result is turned into a priority with `priority_name LIKE 'P{n} -%'`; if nothing matches, whatever priority the client sent is kept.
4. **Board setup depends on the entry point.** The REST board API writes a raw row: no statuses, no default priority, no ITIL rows, and delete skips every check the web runs. On the web, the default priority is chosen before the ITIL priorities exist. The server accepts a board whose categories and priorities are of different kinds although the settings screen offers one switch. A board's kind cannot be changed from the UI at all.
5. **The automatic SLA policy for a new ITIL board depends on a page render.** The hook that creates it is registered from an MSP layout component, not at server startup, and is skipped silently when unset. The policy is found by its name. Workflow `TICKET_SLA_STAGE_*` events are computed from a hard-coded table of hours instead of the ticket's SLA.
6. **Category and priority writes have holes.** `updateTicketCategory` accepts arbitrary fields including the ITIL flag and `board_id`; web `deleteCategory` has no permission check; the reference-data delete used by onboarding has neither a permission check nor an ITIL guard; the priority model spreads its input into the insert (`packages/reference-data/src/models/priority.ts:60`), so a crafted call can set the ITIL flag and level; the Activities inline priority picker writes a ticket's priority with no check.

## Decisions

Decided by Natallia (2026-11-21):

- D1. **No SLA is added where it was never configured.** No migration, backfill or edit assigns an SLA policy to an existing board.
- D2. **New ITIL boards keep getting the "ITIL Standard" SLA policy automatically.**
- D3. **Tickets that already break the rules stay editable, and nothing rewrites them silently.** Checks look only at what a change touches. No migration changes a ticket's priority, Impact or Urgency.
- D4. **No new mixed boards.** A board's categories and priorities must be of the same kind. Existing mixed boards are left as they are and keep working.

Settled in review (2026-11-21):

- D5. **A direct priority change on an assessed ITIL ticket clears Impact and Urgency** to "Not assessed". No values are stored that nobody chose. It follows that Impact and Urgency may be empty on an ITIL ticket.
- D6. **Changing an existing board to ITIL does not give it the ITIL SLA policy** (D1). The switch summary tells the admin what SLA the board will have.
- D7. **Workflow `tickets.create` and inbound webhook create fall back** rather than refuse, so an automation never loses a ticket.
- D8. **The ITIL level of a ticket is read from its priority**, not stored on the ticket.

Decided by Natallia (2026-11-22):

- D9. **Every ITIL board owns its own copy of the standard categories**, the way non-ITIL boards own theirs. Categories already attached to an ITIL board that are not standard rows are listed. Priorities stay shared across the tenant.
- D10. **Where a category list spans boards, a standard category is shown once** and matches every board's copy, in filters and in reports.

## Goals

- One shared module holds the rules: which priorities and categories a board offers, whether a priority or category is valid for a board, the ITIL priority for an Impact × Urgency pair, and the default priority of a board.
- Every picker lists through that module. Every ticket create and update is checked through it.
- Every ITIL board has its own standard categories, identified by a link to the standard row, never by name.
- Web and REST board create, update and delete run the same code. A board's kind can be changed through a supported action.
- The SLA hook is registered at startup; the ITIL policy is identified by a flag; SLA stage events use the ticket's real SLA.
- Only ITIL seeding can mark a priority or category as ITIL.
- A test suite runs every surface against a second ITIL board, and a build guard catches new code that bypasses the rules.

## Non-goals

- Repairing existing tickets, or a bulk "map old priority to new" tool.
- Assigning SLA policies to existing boards (D1).
- Per-board priorities. Priorities stay tenant-wide in two families.
- Supporting mixed boards as a feature (D4).
- Adding Impact and Urgency inputs to REST v1 or mobile ticket create. API callers keep setting a priority directly.
- Changing how an SLA policy is resolved (client, then board, then tenant default), including the case where the resolved policy has no target for the ticket's priority.
- Dropping `tickets.itil_priority_level`, `categories.is_from_itil_standard`, or the ten legacy `boards.display_*` columns.
- Merging the two Priority models (`packages/tickets/src/models/priority.ts`, `packages/reference-data/src/models/priority.ts`) or the duplicated SLA policy resolver.
- Deleting categories left without a board by the migration or by a board delete.

## Rules

**R1. Board kind.** `category_type` and `priority_type` must be equal on create, and on any change of either. An existing mixed board can still be edited in every other respect.

**R2. Categories belong to a board.** A category is valid for a ticket when `category.board_id` equals the ticket's board; a subcategory must be a child of the ticket's category. This is the same rule for ITIL and non-ITIL boards.

- Each ITIL board owns a copy of the standard set. Each standard row carries `standard_category_id`.
- While its board is ITIL, a standard row cannot be renamed, re-parented, moved or deleted, and no other category can be added to that board (settings, REST, CSV import, copy between boards).
- Categories already attached to an ITIL board that are not standard rows stay attached and are listed.
- A category with no board is offered by no picker and is not accepted as a new selection. A ticket that already holds one keeps it and stays editable (R5).

**R3. Priorities come in two families.** A ticket priority is valid for a board when its family (`is_from_itil_standard`) matches the board's `priority_type`. The flag and `itil_priority_level` are set only by ITIL seeding.

**R4. Impact × Urgency.** Applies only on a board with ITIL priorities.

| The write supplies | Result |
|---|---|
| Impact and Urgency | Priority is the matrix result, found by `itil_priority_level`. A supplied `priority_id` is ignored. |
| Only one of them | Refused on interactive paths; both dropped on automated paths. |
| A priority only, ticket has no Impact/Urgency | Accepted if it is an ITIL priority. Impact and Urgency stay empty ("Not assessed"). |
| A priority only, ticket already has Impact/Urgency | Accepted if it is an ITIL priority. Impact and Urgency are cleared to "Not assessed" (D5). |

On a board with the tenant's own priorities, Impact and Urgency are not stored.

**R5. Only what a change touches.** An update checks the priority when it changes the priority or the board, and the category when it changes the category, subcategory or board. A ticket that already breaks R2 or R3 can still be edited in every other field.

**R6. Refuse or fall back.** A path with a person or API caller who sees the error refuses an invalid value. A path with nobody to see it never drops the ticket.

| Refuse with a field error | Fall back |
|---|---|
| MSP create and update, create from asset | Inbound email |
| Client portal create | RMM and Huntress alert tickets |
| REST v1 create, update, create from asset (and mobile, MCP and chat through it) | Telephony auto-ticket |
| CSV import (per row) | Contract renewal ticket |
| Teams message action and guest intake, manual telephony ticket | Workflow `tickets.create` (D7) |
| Workflow `tickets.update_fields`, `assets.create_maintenance_ticket` | Inbound webhook create (D7) |
| Inbound webhook update | Service request provider |
| Templates, recurring schedules (already) | Data-migration import |
| Bundle sync (the child keeps its own priority), Activities inline picker, co-managed edit | |

Fall back means: the configured priority if it fits the board; otherwise the board's default priority (R7); otherwise the configured priority unchanged. A category that does not belong to the board is dropped.

**R7. Default priority of a board.** `boards.default_priority_id` if it fits the board; otherwise the level-3 ITIL priority on an ITIL board, or the lowest-order ticket priority of the tenant's own on other boards; otherwise none.

**R8. SLA.** Creating a board with ITIL priorities on a PSA tenant creates the "ITIL Standard" policy if the tenant has none, adds any missing targets for the ITIL priorities, and assigns it to the new board unless the board already has a policy. Nothing else assigns a policy, including a change of board kind (D6). AlgaDesk tenants are skipped as today.

**R9. Category lists that span boards** (the all-boards ticket filter, the client portal ticket filter, reports grouped by category). A standard category appears once, and choosing it matches that standard category on every board in scope. A filter value that holds one board's copy is treated the same way, so existing links and saved views keep returning the same tickets. Non-standard categories are listed as today.

## Users and Primary Flows

1. **Admin sets inbound email defaults.** Picks a board; the priority list shows only priorities that fit it. A row saved earlier with a priority that does not fit shows a warning that emails use the board's default priority until it is changed.
2. **Technician works on a second ITIL board.** The category picker lists the standard categories; templates and recurring schedules for that board save with a category; a saved view on that board keeps its category filter.
3. **Admin creates an ITIL board** from settings, onboarding or the REST API: it has statuses, its own standard categories, a default priority of the right family and, on PSA, the ITIL SLA policy.
4. **Admin changes a board's kind.** Opens the board, chooses "Change board type", sees how many open tickets and settings will no longer fit and what SLA the board will have, confirms. Tickets, settings and the SLA assignment are not changed.
5. **Technician opens a ticket created by email on an ITIL board.** It shows its priority and "Not assessed" for Impact and Urgency; choosing both recomputes the priority.
6. **Technician edits an old ticket whose priority does not fit its board.** Changing the title or status saves. Changing the priority offers only fitting priorities.
7. **Dispatcher filters all boards by "Hardware".** One entry; tickets from every ITIL board come back.

## UX / UI Notes

All new strings go through `t()` in every locale; every new interactive element has a kebab-case `id`.

- **Inbound ticket defaults** (`packages/integrations/src/components/email/forms/InboundTicketDefaultsForm.tsx`): priority select filtered by the selected board; changing the board clears a priority that no longer fits; inline warning on a stored value that does not fit or no longer exists; the same warning as a badge in the defaults list.
- **Boards settings** (`packages/tickets/src/components/settings/BoardsSettings.tsx`): the single ITIL switch on create stays. The edit dialog gains "Change board type" (`board-change-type-button`) opening a confirmation. A legacy mixed board shows both kinds read-only.
- **Change board type confirmation** lists: open tickets on the board whose priority will not fit; inbound defaults, templates and schedules for the board whose priority will not fit; and the board's SLA after the switch — "no SLA policy", or "policy X has no targets for the priorities this board will use, so new tickets get no due dates".
- **Categories settings** (`CategoriesSettings.tsx`): an ITIL board shows its own set with a "Standard" badge; edit, delete and add are disabled there; the copy dialog offers only non-ITIL boards as targets.
- **Ticket detail and quick add** (`TicketInfo.tsx`, `bento/BentoHero.tsx`, `QuickAddTicket.tsx`): on an ITIL board with empty Impact and Urgency, show the stored priority and "Not assessed".
- **CSV import dialog** (`TicketImportDialog.tsx`): priority mapping uses each row's board; on an ITIL board unmatched categories are reported per row, with no "create new".
- **Priority pickers elsewhere** show only priorities that fit the selected or the ticket's board: workflow designer (both copies), Huntress settings, co-managed ticket edit, service request editor, create ticket from asset, Activities inline picker, mobile ticket detail.
- **All-boards and client portal category filters**: one entry per standard category (R9).

## Data Model and API

- `categories.standard_category_id uuid NULL`: the `standard_categories.id` a row was copied from. Partial unique index on `(tenant, board_id, standard_category_id)` where not null. `is_from_itil_standard` stays and is kept equal to "has a standard link".
- `itil_category_remap (tenant, board_id, standard_category_id, old_category_id, new_category_id)`: one row per category id the migration replaced on a board. Kept after the migration.
- `sla_policies.is_itil_standard boolean NOT NULL DEFAULT false`, at most one per tenant.
- `boards.display_itil_impact` and `boards.display_itil_urgency` are dropped; nothing reads them.
- `tickets.itil_priority_level` stays but is no longer written or accepted from clients; readers take the level from the priority row (D8).
- Shared module `shared/lib/tickets/boardFieldRules.ts`: plain functions taking a knex connection or transaction and a tenant, so server actions, REST services, co-managed and `shared/workflow` can all call it. The Impact × Urgency matrix moves to `shared/lib/itil/priorityMatrix.ts`.
- REST: `GET /api/v1/tickets/priorities` accepts `board_id` and returns `itil_priority_level`. Board create, update and delete behave like the web. Board `PUT` with a changed kind runs the type switch. Category and priority create, update and delete enforce R2 and R3. OpenAPI is regenerated.

### Category migration

One migration, idempotent, run per tenant, Citus-safe (self-contained `tenantDb` shim, values selected then updated by parameter, `transaction: false`). The order matters: the mapping is built and used before any flag is cleared.

1. **Add** `standard_category_id` and create `itil_category_remap`.
2. **Map.** For every flagged category, wherever it sits — on an ITIL board, on a non-ITIL board, or with no board — find the standard row it corresponds to by name and parent name. This is the only name match, and it runs once. Children hung under a flagged parent are mapped through that parent, including a tenant's own category that the old name match flagged.
3. **Give every ITIL board its own set.** Rows already on that board are linked in place and keep their ids. Missing standard rows are inserted, parents first. A standard child on the board whose parent sits on another board, or on none, is re-parented to the board's own parent.
4. **Re-point.** Every reference held by an ITIL board to a mapped category that is not that board's own is moved to the board's copy of the same standard category, and the pair is written to `itil_category_remap`:
   - `tickets.category_id` and `subcategory_id`
   - `ticket_templates`, recurring definitions, their overrides and client overrides
   - `inbound_ticket_defaults`
   - saved views: `categoryId`, `categoryIds` and `excludeCategoryIds` in `boards.list_view_settings` and in stored personal board-tab filters
   - JSON settings that name both a board and a category: workflow action inputs, Huntress settings, inbound webhook mappings, checklist rules
5. **Clear** the flag and link on every mapped row that is not on an ITIL board. They become ordinary categories: of their board if they have one, boardless otherwise. No row is deleted.
6. **Add** the unique index.

Outcomes worth stating:

- **The set sits on a board that is no longer ITIL** while other boards are: each ITIL board gets a full copy and its tickets move to it; the original rows stay on the non-ITIL board as that board's own categories.
- **A tenant's own category was flagged by name** and ITIL children were hung under it: the ITIL board gets its own parent, the ITIL children move under it, and the tenant's category keeps its board, its own children and its tickets, without the flag.
- **Flagged categories with no board** (left by deleting the last ITIL board while tickets still used them): references from ITIL boards move to the board's copy. Tickets on other boards keep pointing at them; the rows stay, without the flag or a board, and R2 applies to them.
- Step 4 keeps every ticket on the same category by meaning; only the id changes. No ticket on a non-ITIL board is touched.

### Reversal

`down()` uses `itil_category_remap` to move every reference in step 4 back to its old id, removes the copies inserted in step 3, restores parents, flags and links, and drops the table and column. The table is otherwise kept, so a setting found later that still holds an old id for a board can be corrected by looking up `(board_id, old_category_id)`.

## Rollout

Each phase is shippable on its own, in this order:

1. **Shared rules and the email fix.** Smallest change that stops new tickets being created with a priority that does not fit, for every tenant whose board has a fitting default.
2. **Second-ITIL-board test suite**, with each surface marked expected-fail until its phase lands.
3. **Categories.** The migration, the switch of the three flag-based listers to `board_id`, and the cross-board filter grouping (R9) ship in the same release. With only some of them deployed, ITIL boards list either nothing new or every board's copy, and cross-board filters show one entry per board.
4. **Writers**, creates first (one funnel exists), then updates.
5. **Priority pickers.**
6. **Board lifecycle and type switch.**
7. **SLA.**
8. **Cleanup, guard, docs.**

## Commit groups

The work lands as 16 commits, one per group, in this order. Every feature and test in `features.json` and `tests.json` carries its `commitGroup`, and both files are ordered by group. A group is committed only when all of its features and tests are implemented; a test lives in the group of the feature it covers.

| # | Commit group | What the commit delivers | Features | Tests | Needs |
|---|---|---|---|---|---|
| 1 | `core-rules` | The shared rules module, the matrix, ITIL priority seeding by level, priority write whitelist | F001–F013 | T001–T031 | — |
| 2 | `email-hotfix` | Inbound defaults form, save check, warning; email falls back | F014–F019 | T032–T042 | 1 |
| 3 | `test-harness` | Fixture with two ITIL boards and the surface suite, all rows expected-fail | F020–F021 | T043–T044 | 1 |
| 4 | `category-schema` | The category migration, remap table, reversal, dev seeds | F022–F037 | T045–T074 | — |
| 5 | `category-rules` | Listing and validity by board, per-board seeding, locks, permission and whitelist fixes | F038–F055 | T075–T104 | 1, 4 |
| 6 | `category-filters` | One entry per standard category across boards; view loader translation | F056–F059 | T105–T114 | 4, 5 |
| 7 | `impact-urgency` | Impact × Urgency rule on MSP paths, service requests, templates; level derived; "Not assessed" | F060–F067 | T115–T129 | 1 |
| 8 | `writers-create` | The rule inside `TicketModel.createTicket` and every create path | F068–F079 | T130–T147 | 1, 5, 7 |
| 9 | `writers-update` | Patch preparation at every update site, board moves, bundle sync | F080–F088 | T148–T161 | 1, 5, 7 |
| 10 | `priority-pickers` | Every priority picker lists by board | F089–F099 | T162–T174 | 1 |
| 11 | `board-lifecycle` | Shared create, update and delete for web and REST; no mixed boards | F100–F109 | T175–T187 | 1, 5 |
| 12 | `board-type-switch` | The switch action, its summary and the settings dialog | F110–F118 | T188–T203 | 11 |
| 13 | `sla` | Hook at startup, policy flag, target top-up, single defaults, real-SLA stage events | F119–F126 | T204–T216 | 7, 11 |
| 14 | `cleanup` | Dead code and the two unread board columns | F127–F131 | T217–T221 | 7, 13 |
| 15 | `guard` | Build guard and writer contract test | F132–F133 | T222–T224 | 8, 9, 10 |
| 16 | `docs` | Rewritten ITIL doc, report script, OpenAPI | F134–F137 | T225–T228 | all |

Releases: commits 1–2 can ship alone as the hotfix. Commits 4, 5 and 6 must reach production together (see Rollout). Everything else can ship as it lands.

## Risks

- **Paths that start refusing.** Client portal create, CSV import, Teams, workflow `update_fields`, inbound webhook update and REST category and priority writes did not validate before. Callers that relied on that get a field error. The messages name the field, the value and the board.
- **Categories that become visible.** Categories attached to an ITIL board that are not standard rows are hidden by the main picker today and will be listed after phase 3.
- **Ids stored where the migration cannot see them.** A setting that stores a category id without a board, or a view kept in the browser, cannot be re-pointed. The view loader therefore translates a standard category of another board to the current board's copy instead of dropping it (R9), and `itil_category_remap` allows a later correction.
- **Cross-board grouping changes filter semantics.** A link that today returns one board's "Hardware" tickets from an all-boards view returns every ITIL board's after R9.
- **SLA stage events.** Building them from the ticket's SLA means tickets without an SLA emit none. Workflows keyed on those events for such tickets stop firing.
- **A board switched away from ITIL keeps an ITIL-only SLA policy.** New tickets there get no due dates until the admin changes the policy. This follows from D1; the confirmation says so.
- **Hook at startup.** `registerSlaIntegration` pulls server-only dependencies; it must be imported the way `initializeApp` imports its other registrations. Whether the production webpack build shares one module instance between startup code and server actions is unverified and gets a test.

## Open Questions

None. Items still to verify in code before implementation are listed in `SCRATCHPAD.md`.

## Acceptance Criteria

- On a tenant with one non-ITIL board and two ITIL boards, every picker in the surface suite lists the same priorities and categories for both ITIL boards, and none lists a value the server then refuses.
- Every writer in R6 either refuses a priority or category that does not fit the board or falls back as specified; no writer stores a newly chosen priority of the wrong family when a fitting one exists.
- A ticket that already breaks R2 or R3 saves a change to its title, status, assignee and description.
- Creating an ITIL board through the settings screen, onboarding and `POST /api/v1/boards` produces the same rows: statuses, 35 standard categories owned by the board, a default priority of the ITIL family and, on PSA, the ITIL SLA policy assigned.
- Creating a second ITIL board never changes a category on any other board.
- After the migration, every ticket, template, schedule, inbound default and saved view on an ITIL board that referenced a standard category references that board's own copy of it, whichever board or no board the original row sat on; `down()` restores the original ids.
- A saved view on a second ITIL board keeps its category filter.
- The all-boards and client portal category filters list each standard category once and return its tickets from every ITIL board.
- A board with different category and priority kinds cannot be created or produced by an update; an existing one still saves other edits.
- Changing a board's kind changes no ticket, inbound default, template, schedule or SLA assignment, and the confirmation states the board's SLA after the switch.
- No call to a category or priority create or update can set the ITIL flag, level or standard link.
- No migration in this plan changes a ticket's priority, Impact or Urgency, or assigns an SLA policy.
- The guard script fails on a new direct read of `priorities` or `categories` for a picker, or a new direct write of a ticket's priority, category or board, outside the allow-list.
- `docs/itil/itil-integration.md` describes the rules above and nothing that does not exist.
