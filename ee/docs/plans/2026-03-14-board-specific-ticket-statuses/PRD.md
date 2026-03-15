# PRD — Board-Specific Ticket Statuses

- Slug: `board-specific-ticket-statuses`
- Date: `2026-03-14`
- Status: Draft

## Summary
Move ticket statuses from a tenant-wide shared list to board-owned records so different service boards can maintain independent ticket lifecycles. The change must preserve existing tenants by cloning current ticket statuses onto every board during a one-time migration, automatically remapping tickets and saved configuration where board context exists, and replacing the central ticket status settings with board-level setup and management.

## Problem
All ticket service boards currently share the same ticket status list. That is too restrictive for tenants that use different boards for materially different processes, such as software delivery, service desk triage, billing approvals, or internal renewal workflows. A shared status catalog forces unrelated boards into the same state machine and creates downstream mismatches in workflows, notifications, billing defaults, and operator UX.

The current codebase reflects that assumption in multiple places:
- ticket status lookup actions read tenant-wide `statuses` rows for `status_type = 'ticket'`,
- board setup is separate from ticket status setup,
- ticket status validation commonly checks only `tenant + status_id`,
- saved workflow and billing configuration store raw ticket `status_id` values.

The product needs true per-board ticket statuses, not visual overrides on top of a shared list.

## Goals
1. Make ticket statuses board-owned records with no runtime inheritance or override logic.
2. Preserve existing tenant behavior through a one-time clone-and-remap migration.
3. Replace the central ticket status list with board-level status setup and editing.
4. Ensure every ticket-status picker or validator in the product becomes board-aware.
5. Automatically remap saved ticket-status references when board context exists.
6. Require explicit user status reselection when a ticket board changes.
7. Keep project, interaction, and project-task statuses unchanged in this phase.

## Non-goals
1. Changing project, interaction, or project-task status architecture.
2. Introducing board-level status inheritance, fallback, or overrides.
3. Automatically remapping a ticket's status when the user changes its board at runtime.
4. Shipping a major visual redesign of the settings area beyond what is needed for board-local status management.
5. Versioning external APIs in this phase unless existing contract changes prove unavoidable.

## Users and Primary Flows
Users:
- Service manager / admin:
  - creates and edits boards,
  - seeds statuses from an existing board or inline,
  - manages board-local status sets.
- Dispatcher / technician / coordinator:
  - creates tickets,
  - edits tickets,
  - changes ticket boards and statuses with valid board-scoped choices.
- Operations / automation admin:
  - manages inbound defaults, workflow ticket actions, billing renewal defaults, and other saved config that reference ticket statuses.

Primary flows:
1. Create a new board and choose either `Copy statuses from existing board` or `Create statuses inline`.
2. Edit an existing board's status list locally without affecting any other board.
3. Create a ticket by selecting a board first and then selecting one of that board's statuses.
4. Change a ticket's board and explicitly choose a valid destination-board status.
5. Continue using existing workflows, defaults, notifications, and reporting after migration with remapped status ids.

## UX / UI Notes
1. Ticket status management moves into board setup and board edit flows.
2. The current central ticket status settings surface is no longer the source of truth for ticket statuses.
3. Board create/edit needs a board-local status manager supporting:
   - add,
   - rename,
   - reorder,
   - default selection,
   - open/closed toggle,
   - delete with dependency validation.
4. New board creation needs two seeding paths:
   - `Copy from existing board`
   - `Create statuses inline`
5. Board-local inline creation must require at least one open default status before save.
6. Any ticket-status picker must depend on board context:
   - if board is unset, status options are disabled or empty,
   - if board changes, prior ticket status selection is invalidated and the user must reselect.

## Requirements

### Functional Requirements
#### FR1 — Board-Owned Ticket Status Data Model
1. Keep using the existing `statuses` table as the canonical status store.
2. Add `board_id` to ticket status rows.
3. Require ticket statuses to be board-owned after migration.
4. Leave non-ticket statuses on their current tenant-wide model.
5. Enforce board-aware uniqueness and default rules for ticket statuses.

#### FR2 — One-Time Migration And Remap
1. For every tenant board, clone the current tenant-wide ticket statuses into new board-owned ticket status rows.
2. Preserve status metadata during cloning, including names, order, default/open-closed state, color/icon, and reference linkage.
3. Generate a deterministic mapping from old global ticket status ids to new board-owned ticket status ids per board.
4. Remap existing tickets to the board-owned cloned status ids.
5. Remap saved ticket-status references wherever board context exists.
6. Surface or fail any persisted ticket-status reference that cannot be remapped safely because board context is missing.

#### FR3 — Board Setup And Board-Local Status Management
1. Board creation must support copying statuses from an existing board.
2. Board creation must support creating statuses inline.
3. Board edit must expose the board's local status list.
4. Board-local status operations must support create, update, delete, reorder, open/closed, and default designation.
5. Board-local status rules must preserve at least one valid open default status.

#### FR4 — Ticket Lifecycle Validation
1. Ticket creation must validate that `status_id` belongs to the selected `board_id`.
2. Ticket updates must validate board/status compatibility.
3. Board changes on tickets must require explicit selection of a valid destination-board status.
4. Default ticket status resolution must become board-aware.
5. Ticket flows that previously assumed tenant-global statuses must be updated to board-local semantics.

#### FR5 — Dependent Configuration Surfaces
1. Inbound ticket defaults must select statuses from the chosen board.
2. Billing renewal defaults and per-contract renewal ticket defaults must select statuses from the chosen board.
3. Any board-aware ticket creation helper or setup form must require board-first status selection.
4. Existing saved config using ticket `status_id` must be migrated to remapped board-owned ids when board context exists.

#### FR6 — Workflows And Automation
1. Workflow ticket action authoring must use board-aware ticket status pickers.
2. Workflow runtime validation must reject ticket status ids that do not belong to the relevant board.
3. Ticket close/default/open status resolution in workflow runtime must use the ticket's board-owned statuses.
4. Saved workflow ticket status references must be remapped during migration when board context exists.

#### FR7 — Query, API, And Read Surface Alignment
1. Ticket-status lookup APIs must become board-scoped for ticket use cases.
2. Ticket services and search/report queries must continue to resolve status metadata correctly after migration.
3. Generic status actions and endpoints must stop treating ticket statuses as tenant-global rows.
4. Client portal ticket creation/update and any public-facing ticket surface must use board-scoped statuses.

#### FR8 — Downstream Ticket-Status Consumers
1. SLA pause configuration and SLA reporting must continue to work with board-owned ticket statuses.
2. Notifications, surveys, and other event subscribers that resolve old/new ticket statuses by id must continue to work after remap.
3. Onboarding, imports, seed paths, and fixtures that create ticket statuses must adopt board-owned ticket status creation.

### Non-functional Requirements
1. Migration must be deterministic and safe to validate in a DB-backed test environment.
2. Board/status validation must preserve tenant isolation on all read and write paths.
3. The system must not guess a board for persisted ticket-status references that lack enough context for a safe remap.
4. Board-scoped ticket status queries must preserve existing UX expectations for ticket create/edit and list/report surfaces.

## Data / API / Integrations
### Data model
1. Add `board_id` to `statuses`.
2. Keep `board_id` nullable for non-ticket statuses.
3. Require `board_id` for `status_type = 'ticket'` after migration.
4. Add constraints and/or indexes that support:
   - board-scoped ticket status uniqueness,
   - board-scoped default resolution,
   - efficient joins from tickets to statuses.

### Migration shape
1. Read current tenant-wide ticket statuses per tenant.
2. Read all boards per tenant.
3. Clone ticket statuses once per board with new `status_id` values.
4. Materialize a remap table or deterministic in-migration mapping from old global ticket status ids to new board-owned ids per board.
5. Update `tickets.status_id` using the ticket's current `board_id`.
6. Update persisted ticket-status references in dependent tables and serialized workflow/config payloads when board context is available.

### API and action surfaces
1. `getTicketStatuses` and related status actions must accept board scope for ticket statuses.
2. Ticket services and API controllers must validate `board_id + status_id` compatibility.
3. `/api/v1/tickets/statuses` should become a board-scoped lookup for ticket statuses.
4. Generic status endpoints/actions must either scope ticket statuses by board or stop being the ticket-status source of truth.

### Integrations and affected subsystems
- Ticket create/edit, quick add, bulk updates, imports, and board changes.
- Client portal ticket surfaces.
- Inbound ticket defaults.
- Billing renewal default ticket routing.
- Workflow designer ticket actions and workflow runtime ticket operations.
- SLA pause config/reporting.
- Notifications, surveys, and event subscribers.
- Onboarding, fixtures, seeds, and test harnesses.

## Security / Permissions
1. Existing board and ticket permissions continue to govern board-local status management and ticket updates.
2. Migration must remain tenant-scoped for all cloned statuses and remapped references.
3. Board-local status CRUD must not permit cross-board or cross-tenant mutation through reused generic status actions.

## Observability
No new observability framework is required for this phase. Reuse existing migration logging, validation errors, and subsystem-specific diagnostics. The main requirement is that migration failures clearly identify unresolved persisted ticket-status references that lack safe board context.

## Rollout / Migration
1. Add the schema changes for board-owned ticket statuses.
2. Implement clone-and-remap migration for existing tenants.
3. Land read/write validation changes so runtime only accepts board-valid ticket statuses.
4. Replace central ticket status management with board-local setup/editing.
5. Update downstream configuration surfaces and workflow authoring/runtime.
6. Update onboarding, fixtures, and tests to create board-owned ticket statuses going forward.

Key migration note:
- automatic remap is required where board context exists,
- any persisted ticket-status reference without safe board context must be surfaced explicitly before release rather than guessed.

## Open Questions
1. Which persisted ticket-status references, if any, lack enough board context today and therefore need a schema or payload change before implementation can be considered complete?
2. Should generic status API endpoints continue exposing ticket statuses at all once ticket lookups are board-scoped, or should ticket clients move entirely to board/ticket-specific status lookup paths?

## Acceptance Criteria (Definition of Done)
1. Ticket statuses are board-owned records, while non-ticket statuses remain unchanged.
2. Existing tenants are migrated by cloning current ticket statuses per board and remapping tickets to the new board-owned ids.
3. Saved ticket-status references are automatically remapped when board context exists.
4. Board create/edit flows allow copying statuses from an existing board or creating statuses inline.
5. The central ticket status settings surface no longer acts as the ticket status source of truth.
6. Ticket creation and update paths only accept statuses that belong to the selected board.
7. Changing a ticket's board requires explicit destination-board status selection.
8. Workflow ticket actions, inbound defaults, billing renewal defaults, client portal ticket flows, SLA status consumers, notifications, and surveys continue to work with board-owned ticket statuses.
9. Onboarding, seeds, fixtures, and regression tests are updated for the new board-specific ticket status model.
10. Features and tests are populated and traceable to this PRD.
