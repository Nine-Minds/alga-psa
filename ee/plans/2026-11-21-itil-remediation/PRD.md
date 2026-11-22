# PRD — ITIL boards: one set of rules

- Slug: `itil-remediation`
- Date: `2026-11-21`
- Status: Draft

## Summary

A ticket board is either ITIL or not. An ITIL board uses the five ITIL priorities (chosen through Impact × Urgency) and the standard ITIL category set; every other board uses the tenant's own priorities and categories. Today that rule is enforced in a few places and ignored in most, the standard categories only work on the first ITIL board of a tenant, and board setup behaves differently depending on which entry point created the board.

This plan puts the rules in one shared place, makes every screen that offers a priority or category and every path that writes one use them, gives each ITIL board its own categories, makes board setup identical on the web and the REST API, and adds tests and a build guard so the rules stay applied.

## Problem

1. **Tickets get a priority that does not belong to their board.** The priority/board check from PR #3880 (`packages/tickets/src/lib/ticketFieldReferences.ts`) runs on MSP create and update, REST create and update, and templates and recurring tickets. It does not run on client portal create, inbound email, CSV import, service requests, workflow actions, Teams, inbound webhooks, bundle sync, RMM and Huntress alert tickets, telephony, renewal tickets, or the Activities inline priority picker. Several settings screens that feed those paths (inbound email defaults, workflow designer, Huntress, inbound webhooks, service requests) offer priorities of both kinds.
2. **ITIL categories only work on the first ITIL board.** `ItilStandardsService.copyItilCategoriesToTenant` creates one set per tenant, stamped with the `board_id` of the first board that enabled ITIL. The main ticket form lists them by flag, but nine other pickers filter by `board_id` alone and come back empty on any other ITIL board, and the validator at `ticketFieldReferences.ts:211` rejects the category the picker just offered, so templates and recurring tickets cannot save one there.
3. **The standard set is matched by name.** The copy step looks up existing rows by name across the whole tenant and flags whatever it finds, so a tenant's own "Hardware" category on another board becomes an ITIL row. The Impact × Urgency result is turned into a priority with `priority_name LIKE 'P{n} -%'`; if nothing matches, whatever priority the client sent is kept.
4. **Board setup depends on the entry point.** The REST board API writes a raw row: no statuses, no default priority, no ITIL rows, and delete skips every check the web runs. On the web, the default priority is chosen before the ITIL priorities exist. The server accepts a board whose categories and priorities are of different kinds although the settings screen offers one switch. A board's kind cannot be changed from the UI at all.
5. **The automatic SLA policy for a new ITIL board depends on a page render.** The hook that creates it is registered from an MSP layout component, not at server startup, and is skipped silently when unset. The policy is found by its name. Workflow `TICKET_SLA_STAGE_*` events are computed from a hard-coded table of hours instead of the ticket's SLA.
6. **Category actions have holes.** `updateTicketCategory` accepts arbitrary fields including the ITIL flag and `board_id`; web `deleteCategory` has no permission check; the reference-data delete used by onboarding has neither a permission check nor an ITIL guard; the Activities inline priority picker writes a ticket's priority with no check.

## Decisions

Decided by Natallia (2026-11-21):

- D1. **No SLA is added where it was never configured.** No migration, backfill or edit assigns an SLA policy to an existing board.
- D2. **New ITIL boards keep getting the "ITIL Standard" SLA policy automatically.**
- D3. **Tickets that already break the rules stay editable, and nothing rewrites them silently.** Checks look only at what a change touches. No migration changes a ticket's priority, Impact or Urgency.
- D4. **No new mixed boards.** A board's categories and priorities must be of the same kind. Existing mixed boards are left as they are and keep working.

Assumed in this draft, to be confirmed (see Open Questions):

- A1. Every ITIL board owns its own copy of the standard categories; priorities stay shared across the tenant.
- A2. Impact and Urgency may be empty on an ITIL ticket.

## Goals

- One shared module holds the rules: which priorities and categories a board offers, whether a priority or category is valid for a board, the ITIL priority for an Impact × Urgency pair, and the default priority of a board.
- Every picker lists through that module. Every ticket create and update is checked through it.
- Every ITIL board has its own standard categories, identified by a link to the standard row, never by name.
- Web and REST board create, update and delete run the same code. A board's kind can be changed through a supported action.
- The SLA hook is registered at startup; the ITIL policy is identified by a flag; SLA stage events use the ticket's real SLA.
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

## Rules

**R1. Board kind.** `category_type` and `priority_type` must be equal on create, and on any change of either. An existing mixed board can still be edited in every other respect.

**R2. Categories belong to a board.** A category is valid for a ticket when `category.board_id` equals the ticket's board; a subcategory must be a child of the ticket's category. This is the same rule for ITIL and non-ITIL boards.

- Each ITIL board owns a copy of the standard set. Each standard row carries `standard_category_id`.
- While its board is ITIL, a standard row cannot be renamed, re-parented, moved or deleted, and no other category can be added to that board (settings, REST, CSV import, copy between boards).
- Categories already attached to an ITIL board that are not standard rows stay attached and are listed.

**R3. Priorities come in two families.** A ticket priority is valid for a board when its family (`is_from_itil_standard`) matches the board's `priority_type`.

**R4. Impact × Urgency.** Applies only on a board with ITIL priorities.

| The write supplies | Result |
|---|---|
| Impact and Urgency | Priority is the matrix result, found by `itil_priority_level`. A supplied `priority_id` is ignored. |
| Only one of them | Refused on interactive paths; both dropped on automated paths. |
| A priority only, ticket has no Impact/Urgency | Accepted if it is an ITIL priority. Impact and Urgency stay empty ("not assessed"). |
| A priority only, ticket already has Impact/Urgency | Accepted; Impact and Urgency are set to the pair on the matrix diagonal for that level, so they keep agreeing. |

On a board with the tenant's own priorities, Impact and Urgency are not stored.

**R5. Only what a change touches.** An update checks the priority when it changes the priority or the board, and the category when it changes the category, subcategory or board. A ticket that already breaks R2 or R3 can still be edited in every other field.

**R6. Refuse or fall back.** A path with a person or API caller who sees the error refuses an invalid value. A path with nobody to see it never drops the ticket.

| Refuse with a field error | Fall back |
|---|---|
| MSP create and update, create from asset | Inbound email |
| Client portal create | RMM and Huntress alert tickets |
| REST v1 create, update, create from asset (and mobile, MCP and chat through it) | Telephony auto-ticket |
| CSV import (per row) | Contract renewal ticket |
| Teams message action and guest intake, manual telephony ticket | Workflow `tickets.create` |
| Workflow `tickets.update_fields`, `assets.create_maintenance_ticket` | Inbound webhook create |
| Inbound webhook update | Service request provider |
| Templates, recurring schedules (already) | Data-migration import |
| Bundle sync (the child keeps its own priority), Activities inline picker, co-managed edit | |

Fall back means: the configured priority if it fits the board; otherwise the board's default priority (R7); otherwise the configured priority unchanged. A category that does not belong to the board is dropped.

**R7. Default priority of a board.** `boards.default_priority_id` if it fits the board; otherwise the level-3 ITIL priority on an ITIL board, or the lowest-order ticket priority of the tenant's own on other boards; otherwise none.

**R8. SLA.** Creating a board with ITIL priorities on a PSA tenant creates the "ITIL Standard" policy if the tenant has none, adds any missing targets for the ITIL priorities, and assigns it to the new board unless the board already has a policy. Nothing else assigns a policy. AlgaDesk tenants are skipped as today.

## Users and Primary Flows

1. **Admin sets inbound email defaults.** Picks a board; the priority list shows only priorities that fit it. A row saved earlier with a priority that does not fit shows a warning that emails use the board's default priority until it is changed.
2. **Technician works on a second ITIL board.** The category picker lists the standard categories; templates and recurring schedules for that board save with a category.
3. **Admin creates an ITIL board** from settings, onboarding or the REST API: it has statuses, its own standard categories, a default priority of the right family and, on PSA, the ITIL SLA policy.
4. **Admin changes a board's kind.** Opens the board, chooses "Change board type", sees how many open tickets and settings will no longer fit, confirms. Tickets and settings are not changed.
5. **Technician opens a ticket created by email on an ITIL board.** It shows its priority and "Not assessed" for Impact and Urgency; choosing both recomputes the priority.
6. **Technician edits an old ticket whose priority does not fit its board.** Changing the title or status saves. Changing the priority offers only fitting priorities.

## UX / UI Notes

All new strings go through `t()` in every locale; every new interactive element has a kebab-case `id`.

- **Inbound ticket defaults** (`packages/integrations/src/components/email/forms/InboundTicketDefaultsForm.tsx`): priority select filtered by the selected board; changing the board clears a priority that no longer fits; inline warning on a stored value that does not fit or no longer exists; the same warning as a badge in the defaults list.
- **Boards settings** (`packages/tickets/src/components/settings/BoardsSettings.tsx`): the single ITIL switch on create stays. The edit dialog gains "Change board type" (`board-change-type-button`) opening a confirmation with the summary from the type-switch flow. A legacy mixed board shows both kinds read-only.
- **Categories settings** (`CategoriesSettings.tsx`): an ITIL board shows its own set with a "Standard" badge; edit, delete and add are disabled there; the copy dialog offers only non-ITIL boards as targets.
- **Ticket detail and quick add** (`TicketInfo.tsx`, `bento/BentoHero.tsx`, `QuickAddTicket.tsx`): on an ITIL board with empty Impact and Urgency, show the stored priority and "Not assessed".
- **CSV import dialog** (`TicketImportDialog.tsx`): priority mapping uses each row's board; on an ITIL board unmatched categories are reported per row, with no "create new".
- **Priority pickers elsewhere** show only priorities that fit the selected or the ticket's board: workflow designer (both copies), Huntress settings, co-managed ticket edit, service request editor, create ticket from asset, Activities inline picker, mobile ticket detail.

## Data Model and API

- `categories.standard_category_id uuid NULL`: the `standard_categories.id` a row was copied from. Partial unique index on `(tenant, board_id, standard_category_id)` where not null. `is_from_itil_standard` stays and is kept equal to "has a standard link".
- `sla_policies.is_itil_standard boolean NOT NULL DEFAULT false`, at most one per tenant.
- `boards.display_itil_impact` and `boards.display_itil_urgency` are dropped; nothing reads them.
- `tickets.itil_priority_level` stays but is no longer written or accepted from clients; readers take the level from the priority row.
- Shared module `shared/lib/tickets/boardFieldRules.ts`: plain functions taking a knex connection or transaction and a tenant, so server actions, REST services, co-managed and `shared/workflow` can all call it. The Impact × Urgency matrix moves to `shared/lib/itil/priorityMatrix.ts`.
- REST: `GET /api/v1/tickets/priorities` accepts `board_id` and returns `itil_priority_level`. Board create, update and delete behave like the web. Board `PUT` with a changed kind runs the type switch. Category create, update and delete enforce R2. OpenAPI is regenerated.

### Category migration

One migration, idempotent, run per tenant, Citus-safe (self-contained `tenantDb` shim, values selected then updated by parameter, `transaction: false`):

1. Add the column.
2. Link each flagged category to its standard row by name and parent name. This is the only name match, and it runs once.
3. Clear the flag on rows that cannot be linked or sit on a board whose categories are not ITIL. They are ordinary categories of their board.
4. For each ITIL board without its own set, insert the missing standard rows.
5. Re-point references held by other ITIL boards to that board's own copy of the same standard category: `tickets.category_id` and `subcategory_id`, `ticket_templates`, recurring definitions and their overrides, `inbound_ticket_defaults`, and JSON settings that name both a board and a category (workflow action inputs, Huntress settings, inbound webhook mappings, checklist rules).
6. Add the unique index.

Step 5 keeps every ticket on the same category by meaning; only the id changes. The board that holds the set today keeps its rows and ids.

## Rollout

Each phase is shippable on its own, in this order:

1. **Shared rules and the email fix.** Smallest change that stops new tickets being created with a priority that does not fit, for every tenant whose board has a fitting default.
2. **Second-ITIL-board test suite**, with each surface marked expected-fail until its phase lands.
3. **Categories.** The migration and the switch of the three flag-based listers to `board_id` ship in the same release; with only one of them deployed, ITIL boards list either nothing new or every board's copy.
4. **Writers**, creates first (one funnel exists), then updates.
5. **Priority pickers.**
6. **Board lifecycle and type switch.**
7. **SLA.**
8. **Cleanup, guard, docs.**

## Risks

- **Paths that start refusing.** Client portal create, CSV import, Teams, workflow `update_fields`, inbound webhook update and REST category writes did not validate before. Callers that relied on that get a field error. The messages name the field, the value and the board.
- **Categories that become visible.** Categories attached to an ITIL board that are not standard rows are hidden by the main picker today and will be listed after phase 3.
- **Id remap inside JSON settings.** A setting that stores a category id without a board cannot be re-pointed; it keeps pointing at the original row, which stays valid on the board that owns it.
- **SLA stage events.** Building them from the ticket's SLA means tickets without an SLA emit none. Workflows keyed on those events for such tickets stop firing.
- **Hook at startup.** `registerSlaIntegration` pulls server-only dependencies; it must be imported the way `initializeApp` imports its other registrations. Whether the production webpack build shares one module instance between startup code and server actions is unverified and gets a test.

## Open Questions

1. Confirm A1: per-board copies of the standard categories, including listing categories that are already attached to an ITIL board but are not standard rows.
2. Confirm A2 and the fourth row of R4 (a direct priority change on an assessed ticket sets Impact and Urgency to the matching diagonal pair, rather than being refused or clearing them).
3. Changing an existing board to ITIL: does it get the ITIL SLA policy? This draft says no, because D1 treats it as an existing board.
4. Workflow `tickets.create` and inbound webhook create are in the fall-back column so automations never lose a ticket. Should they refuse instead?
5. `tickets.itil_priority_level`: this draft stops writing it and derives it. The alternative is to store it on every write.

## Acceptance Criteria

- On a tenant with one non-ITIL board and two ITIL boards, every picker in the surface suite lists the same priorities and categories for both ITIL boards, and none lists a value the server then refuses.
- Every writer in R6 either refuses a priority or category that does not fit the board or falls back as specified; no writer stores a newly chosen priority of the wrong family when a fitting one exists.
- A ticket that already breaks R2 or R3 saves a change to its title, status, assignee and description.
- Creating an ITIL board through the settings screen, onboarding and `POST /api/v1/boards` produces the same rows: statuses, 35 standard categories owned by the board, a default priority of the ITIL family and, on PSA, the ITIL SLA policy assigned.
- Creating a second ITIL board never changes a category on any other board.
- A board with different category and priority kinds cannot be created or produced by an update; an existing one still saves other edits.
- Changing a board's kind changes no ticket, inbound default, template, schedule or SLA assignment.
- No migration in this plan changes a ticket's priority, Impact or Urgency, or assigns an SLA policy.
- The guard script fails on a new direct read of `priorities` or `categories` for a picker, or a new direct write of a ticket's priority, category or board, outside the allow-list.
- `docs/itil/itil-integration.md` describes the rules above and nothing that does not exist.
