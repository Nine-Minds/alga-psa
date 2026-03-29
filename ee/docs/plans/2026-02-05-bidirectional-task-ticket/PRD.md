# PRD — Bidirectional Task-Ticket Creation

- Slug: `2026-02-05-bidirectional-task-ticket`
- Date: `2026-02-05`
- Status: Draft

## Summary

Add the ability to create project tasks from tickets and tickets from tasks, with field prefilling and optional auto-linking. Three entry points: (1) prefill a new task from an existing ticket, (2) create a ticket prefilled from an existing task, (3) create a project task from the ticket detail screen.

## Problem

Currently, project tasks and tickets are loosely connected — users can link existing tickets to tasks, or create a blank ticket from within a task. But there's no way to:
- Start a new task with data pulled from an existing ticket
- Create a ticket that inherits data from the task it's related to
- Create a project task directly from the ticket screen

This forces users to manually copy titles, descriptions, and other fields between the two entities, which is tedious and error-prone.

## Goals

1. Allow prefilling a new project task from an existing ticket's data
2. Allow creating a ticket prefilled from an existing task's data
3. Allow creating a project task directly from the ticket detail screen
4. Make linking between the created entity and its source optional (checkbox, default on)
5. Propagate compatible fields automatically while respecting system boundaries (e.g., separate priority systems)

## Non-goals

- Syncing fields between linked tasks and tickets after creation (no ongoing sync)
- Transferring priorities (different systems for tasks vs tickets)
- Modifying the existing "Link Ticket" flow in TaskTicketLinks
- Redesigning the TaskTicketLinks or QuickAddTicket UI layout

## Users and Primary Flows

**Target user:** MSP project managers and technicians who work across both project tasks and tickets.

### Flow 1: New Task → Prefill from Ticket (TaskForm create mode)
1. User opens TaskForm in create mode (e.g., adding a task to a project phase)
2. User clicks a small icon button near the task name field (tooltip: "Create from ticket")
3. A dialog opens with a searchable ticket list
4. User selects a ticket
5. User toggles "Link this ticket to the task" (default: on)
6. User clicks "Prefill" / confirm
7. Task fields are populated: name, description, assigned user, due date, estimated hours
8. The selected ticket appears in the Associated Tickets section (if auto-link is on)
9. User adjusts fields as needed, selects status, and saves the task

### Flow 2: Existing Task → Create Ticket (TaskForm edit mode)
1. User is editing an existing task in TaskForm
2. In the "Associated Tickets" section, user clicks "Create Ticket"
3. QuickAddTicket opens with fields prefilled from the task: title, description, assigned user, due date, estimated hours
4. Client is prefilled from the project's client
5. User fills in remaining required ticket fields (board, status, priority)
6. User saves — ticket is created and automatically linked to the task

### Flow 3: Ticket Detail → Create Project Task
1. User is viewing a ticket on the ticket detail page
2. User clicks "Create Project Task" button
3. A dialog opens where user selects: project, phase, status
4. User toggles "Link ticket to the created task" (default: on)
5. User clicks "Create"
6. A drawer opens with TaskForm in create mode, fields prefilled from the ticket
7. User adjusts fields and saves the task

## UX / UI Notes

### Flow 1 UI
- Small icon button (lucide `Ticket` icon) placed next to the "Task Name" label in create mode only
- Tooltip: "Create from ticket"
- Dialog: ticket search input + `TicketSelect` dropdown + auto-link checkbox + Prefill/Cancel buttons

### Flow 2 UI
- No new UI elements — the existing "Create Ticket" button in TaskTicketLinks triggers the same QuickAddTicket dialog, but now with prefilled fields
- Fields that are prefilled should be editable (not locked)

### Flow 3 UI
- Button in TicketDetails header area (near existing action buttons)
- Icon: lucide `ListTodo` or similar, text: "Create Task"
- First dialog: project/phase/status selectors + auto-link checkbox
- Second step: TaskForm opens in a drawer (using existing `useDrawer` pattern)

## Requirements

### Functional Requirements

#### FR-1: Field mapping utility
- Create shared mapping functions for ticket→task and task→ticket field conversion
- Map: title↔task_name, description↔description, assigned_to↔assigned_to, due_date↔due_date, estimated_hours↔estimated_hours (with minutes↔hours conversion)
- Do NOT map priority (separate systems)
- Map client_id from project level for task→ticket direction

#### FR-2: Prefill task from ticket (Scenario 1)
- Icon button visible only in TaskForm create mode
- Clicking opens a dialog with ticket search and selection
- Auto-link checkbox (default: on)
- On confirm, all mappable fields are populated in the form
- If auto-link is on, the ticket is added to pending ticket links

#### FR-3: Create ticket from task (Scenario 2)
- QuickAddTicket accepts new prefill props: title, assigned_to, due_date, estimated_hours
- TaskTicketLinks passes current task field values + project client to QuickAddTicket
- `addTicket` server action parses `estimated_hours` from FormData

#### FR-4: Create task from ticket (Scenario 3)
- Button in TicketDetails rendered via render-prop injection (cross-package pattern)
- Dialog for project/phase/status selection with auto-link checkbox
- On confirm, opens TaskForm in drawer with prefilled fields
- If auto-link is on, ticket is added to pending ticket links in the new task

#### FR-5: Auto-link behavior
- All three flows support an optional auto-link checkbox (default: on)
- When on, the source entity is added to the target's linked items
- For Scenario 1 & 3: ticket added to task's `pendingTicketLinks`
- For Scenario 2: already handled by existing QuickAddTicket→TaskTicketLinks flow

### Non-functional Requirements

- No new database tables or migrations required
- No new API endpoints — use existing server actions
- TypeScript strict mode compliance on all modified files

## Data / API / Integrations

### Existing actions used:
- `getTicketsForList(filters)` — fetch tickets for search
- `getConsolidatedTicketData(ticketId)` — fetch full ticket with description
- `getProjects()` — list projects for selector
- `getProject(projectId)` — get project with client_id
- `getProjectTreeData(projectId)` — get phases for project
- `getProjectTaskStatuses(projectId)` — get statuses for project
- `addTicketLinkAction(projectId, taskId, ticketId, phaseId)` — create link (called on task save)

### Action modification needed:
- `addTicket` in `ticketActions.ts` — add `estimated_hours` parsing from FormData

### Field mapping (with conversions):
| Task Field | Ticket Field | Conversion |
|---|---|---|
| `task_name` | `title` | None |
| `description` | `description` | None (both plain text) |
| `assigned_to` | `assigned_to` | None (both user_id) |
| `due_date` (Date) | `due_date` (ISO string) | Date↔string |
| `estimated_hours` (minutes) | `estimated_hours` (hours) | ÷60 / ×60 |
| — | `client_id` | From `project.client_id` |

## Security / Permissions

- All flows use existing `withAuth`-wrapped server actions
- No new permission checks needed — users who can create tasks/tickets can use these flows

## Rollout / Migration

- No database migrations needed
- No feature flags needed — this is additive functionality
- Backward compatible — existing flows unchanged

## Open Questions

None — all clarified.

## Acceptance Criteria (Definition of Done)

1. User can prefill a new task from an existing ticket in TaskForm create mode
2. User can create a ticket with fields prefilled from an existing task via "Create Ticket" in TaskTicketLinks
3. User can create a project task from the ticket detail screen with project/phase/status selection
4. Auto-link checkbox works in all three flows (default: on)
5. Priorities are never transferred between tasks and tickets
6. Client is correctly inherited from the project when creating a ticket from a task
7. Estimated hours conversion (minutes↔hours) is correct in both directions
8. All modified files pass TypeScript strict mode (`npx tsc --noEmit`)
