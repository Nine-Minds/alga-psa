# Scratchpad — Bidirectional Task-Ticket Creation

- Plan slug: `2026-02-05-bidirectional-task-ticket`
- Created: `2026-02-05`

## Decisions

- (2026-02-05) Priorities are NOT transferred between tasks and tickets — they are separate systems with separate priority tables (`item_type = 'project_task'` vs `item_type = 'ticket'`).
- (2026-02-05) Client for ticket creation is mapped from `IProject.client_id` at the project level, not the task level. Tasks don't have clients.
- (2026-02-05) Auto-linking is optional via a checkbox/toggle (default: on).
- (2026-02-05) Task `estimated_hours` is stored in MINUTES in the database. Display and ticket values are in HOURS. Must convert when mapping.
- (2026-02-05) Ticket `description` is NOT on `ITicket` interface but IS stored in the DB and accessible via FormData / consolidated ticket data attributes.
- (2026-02-05) Use render-prop injection pattern for cross-package composition (TicketDetails → MspTicketDetailsContainerClient), consistent with `renderContactDetails` and `associatedAssets` patterns.

## Progress

- (2026-02-05) Implemented `mapTicketToTaskFields` mapping utility in `packages/projects/src/lib/taskTicketMapping.ts` for ticket→task prefill defaults (safe defaults, due date parsing, estimated hours passthrough).
- (2026-02-05) Added `mapTaskToTicketPrefill` in `packages/projects/src/lib/taskTicketMapping.ts` to derive ticket prefill data from tasks and project client (minutes→hours conversion, client id/name).
- (2026-02-05) Explicitly ignored `priority_id` in both mapping directions to enforce non-mapping of priorities.
- (2026-02-05) Added `PrefillFromTicketDialog` component with searchable `TicketSelect` and lazy ticket list loading.
- (2026-02-05) Added auto-link checkbox (default on) to `PrefillFromTicketDialog` to control link creation.
- (2026-02-05) Prefill dialog now fetches consolidated ticket data and returns mapped task prefill fields via `mapTicketToTaskFields`.
- (2026-02-05) Added `prefillData` support in `TaskForm` to initialize fields and pending ticket link for create-mode prefill.
- (2026-02-05) Added create-mode-only Ticket icon button with tooltip "Create from ticket" next to Task Name label.
- (2026-02-05) Wired `PrefillFromTicketDialog` into `TaskForm` to populate fields and optionally add a pending ticket link.
- (2026-02-05) Added `prefilledTitle` support in `QuickAddTicket` for title initialization and resets.
- (2026-02-05) Added `prefilledAssignedTo` support in `QuickAddTicket` for assigned user initialization and resets.
- (2026-02-05) Added `prefilledDueDate` support in `QuickAddTicket` with safe date parsing for the date picker.
- (2026-02-05) Added `prefilledEstimatedHours` support and an Estimated Hours input in `QuickAddTicket`.
- (2026-02-05) QuickAddTicket now appends `estimated_hours` to FormData when provided.
- (2026-02-05) Parsed `estimated_hours` in `addTicket` and plumbed it through `ticketModel` creation/schema.
- (2026-02-05) Added `taskData` prop to `TaskTicketLinks` for passing current task field values.
- (2026-02-05) TaskTicketLinks now fetches project client data before opening QuickAddTicket.
- (2026-02-05) TaskTicketLinks now maps task data to QuickAddTicket prefill props (title/description/assignee/due date/estimated hours + client).
- (2026-02-05) TaskForm now passes edit-mode field values as `taskData` (minutes) into TaskTicketLinks.
- (2026-02-05) Added `CreateTaskFromTicketDialog` with project selector and supporting state for project-driven task creation.
- (2026-02-05) CreateTaskFromTicketDialog now refreshes phases/statuses whenever the selected project changes.
- (2026-02-05) Phase selector now derives options from fetched phases and disables when none are available.
- (2026-02-05) Status selector now derives options from fetched statuses and disables when none are available.
- (2026-02-05) CreateTaskFromTicketDialog resets auto-link checkbox to on when opened.
- (2026-02-05) CreateTaskFromTicketDialog now opens TaskQuickAdd in a drawer with ticket-derived prefill data and optional pending link.
- (2026-02-05) TaskQuickAdd now accepts `prefillData` and forwards it into TaskForm.
- (2026-02-05) Added `renderCreateProjectTask` render prop hook in `TicketDetails` header area.
- (2026-02-05) TicketDetailsContainer now forwards `renderCreateProjectTask` to TicketDetails.
- (2026-02-05) MSP ticket container now injects CreateTaskFromTicketDialog via `renderCreateProjectTask`.

## Discoveries / Constraints

- (2026-02-05) `TicketSelect` component already exists at `packages/projects/src/components/TicketSelect.tsx` — reusable for ticket search in Scenario 1.
- (2026-02-05) `QuickAddTicket` already has `prefilledClient`, `prefilledContact`, `prefilledDescription` props. Need to add: `prefilledTitle`, `prefilledAssignedTo`, `prefilledDueDate`, `prefilledEstimatedHours`.
- (2026-02-05) `addTicket` server action does NOT parse `estimated_hours` from FormData (line ~220 in ticketActions.ts). Must add.
- (2026-02-05) `TaskForm` has `prefillData`-like initialization already: `useState(task?.task_name || '')`. Can extend with a `prefillData` prop.
- (2026-02-05) No `ProjectPicker` or `PhasePicker` components exist. Use `CustomSelect` with `getProjects()` and `getProjectTreeData()`.
- (2026-02-05) `useDrawer` hook supports opening TaskForm in a drawer with full history management.
- (2026-02-05) `TaskQuickAdd` wraps `TaskForm` — need to pass `prefillData` through.
- (2026-02-05) React synthetic events propagate through portals. QAT form submit was bubbling to TaskForm — fixed with `e.stopPropagation()`.

## Commands / Runbooks

- Build check: `npx tsc --noEmit -p packages/projects/tsconfig.json && npx tsc --noEmit -p packages/tickets/tsconfig.json`
- Run dev: `npm run dev`

## Links / References

- Key files:
  - `packages/projects/src/components/TaskForm.tsx` — main task form (create/edit)
  - `packages/projects/src/components/TaskTicketLinks.tsx` — ticket linking in task form
  - `packages/projects/src/components/TicketSelect.tsx` — searchable ticket selector
  - `packages/tickets/src/components/QuickAddTicket.tsx` — inline ticket creation
  - `packages/tickets/src/components/ticket/TicketDetails.tsx` — ticket detail view
  - `packages/tickets/src/components/ticket/TicketDetailsContainer.tsx` — container with injection props
  - `packages/msp-composition/src/tickets/MspTicketDetailsContainerClient.tsx` — MSP composition layer
  - `packages/tickets/src/actions/ticketActions.ts` — addTicket server action
  - `packages/projects/src/actions/projectActions.ts` — getProjects, getProjectTreeData
  - `packages/projects/src/actions/projectTaskActions.ts` — addTicketLinkAction
  - `packages/types/src/interfaces/ticket.interfaces.ts` — ITicket
  - `packages/types/src/interfaces/project.interfaces.ts` — IProjectTask

## Open Questions

- None currently — all clarified with user.
