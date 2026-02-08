# PRD: Scheduling Context Facade (Agent Schedule + Time Entry)

- Slug: `scheduling-context-facade`
- Date: `2026-02-05`
- Status: Draft

## Summary

Restore the Agent Schedule Drawer and Add Time Entry features that were stubbed during the Jan 2026 modularization refactor. Use a React Context facade in `@alga-psa/ui` to avoid cross-package imports, with real implementations provided from the composition layer.

## Problem

During the `c43321e4c` refactor ("continue modularization of actions and components", Jan 20 2026), scheduling features were removed from consumer packages (tickets, clients, projects) and consolidated into `@alga-psa/scheduling`. The old imports were replaced with stubs:

1. **Agent Schedule Drawer** — `AgentScheduleDrawer.tsx` in tickets shows "Agent schedule view is now owned by Scheduling." instead of a calendar. Triggered from:
   - Ticket detail → click agent name
   - Interaction detail → click user name

2. **Add Time Entry** — Three handlers show `toast('Time entry is managed in Scheduling.')` instead of opening the time entry dialog. Triggered from:
   - Ticket detail → "Add Time Entry" button
   - Interaction detail → "Add Time Entry" button
   - Project task → "Add Time Entry" button

## Goals

1. **Restore Agent Schedule Drawer** — clicking an agent/user name opens a single-agent calendar in a drawer
2. **Restore Add Time Entry** — clicking "Add Time Entry" opens the TimeEntryDialog with correct work-item context
3. **No cross-package dependencies** — use a React Context facade pattern; consumer packages (tickets, clients, projects) must NOT import from `@alga-psa/scheduling`
4. **Graceful fallback** — if the context provider is absent, stubs degrade to the current alert/toast behavior

## Non-Goals

- Full-page schedule view in drawers (sidebar, multi-technician comparison, appointment requests)
- Modifying the existing `ScheduleCalendar` component (it stays as-is for the scheduling page)
- Timer feature changes (timer state is passed through, not modified)
- Editing the TimeEntryDialog component itself

## Architecture

### Pattern: React Context Facade

```
@alga-psa/ui                 — defines SchedulingContext (interface + hook + no-op default)
@alga-psa/scheduling          — provides AgentScheduleView + timeEntryLauncher (real implementations)
@alga-psa/msp-composition     — creates MspSchedulingProvider (imports from scheduling, provides context)
server pages                  — wraps relevant pages with MspSchedulingProvider
consumer components           — call useSchedulingCallbacks() to get renderAgentSchedule / launchTimeEntry
```

**Why this pattern:**
- All consumer packages already depend on `@alga-psa/ui` — no new deps needed
- Follows the established DI pattern (like `renderContactDetails`, `renderClientDetails`)
- The composition layer (`msp-composition`) already exists for tickets
- Context avoids deep prop threading through 3-4 layers of components

### Context Interface

```ts
interface SchedulingCallbacks {
  renderAgentSchedule: (agentId: string) => React.ReactNode;
  launchTimeEntry: (params: {
    openDrawer: OpenDrawerFn;
    closeDrawer: () => void;
    context: TimeEntryWorkItemContext;
    onComplete?: () => void;
  }) => Promise<void>;
}
```

## Users and Primary Flows

### Flow 1: View Agent Schedule (from Ticket)
1. User opens a ticket detail page
2. Clicks on an agent name in the ticket properties
3. Drawer opens with the agent's weekly calendar
4. Events are color-coded by type (ticket, project task, interaction, etc.)
5. User can click events to view details via EntryPopup

### Flow 2: View Agent Schedule (from Interaction)
1. User opens an interaction detail
2. Clicks on the assigned user name
3. Same drawer experience as Flow 1

### Flow 3: Add Time Entry (from Ticket)
1. User clicks "Add Time Entry" on a ticket
2. System fetches current time period and creates/fetches time sheet
3. TimeEntryDialog opens in drawer mode with ticket context pre-filled
4. User enters time, selects service, saves
5. Timer resets (if running)

### Flow 4: Add Time Entry (from Interaction)
1. User clicks "Add Time Entry" on an interaction
2. Same dialog flow; pre-filled with interaction type, client, and start/end times from interaction

### Flow 5: Add Time Entry (from Project Task)
1. User clicks "Add Time Entry" on a project task form
2. Same dialog flow; pre-filled with project/phase/task names and service if configured

## UX / UI Notes

### Agent Schedule Drawer
- Default view: **week** (fits drawer width better than month)
- Shows: day/week/month view toggle, navigable date range
- Events: color-coded by work item type, clickable for details
- Auto-scrolls to 8 AM on open
- Respects permissions: `user_schedule:read` (own), `user_schedule:read:all` (others)

### Time Entry Dialog
- Opens via `openDrawer()` in `inDrawer: true` mode
- Pre-fills work item info, date, default times
- Handles: service selection, duration, notes, billability
- Shows toast on save success/failure
- Calls `onComplete` callback for timer reset

## Data / API / Integrations

### Existing Actions (in @alga-psa/scheduling)

| Action | Location | Purpose |
|--------|----------|---------|
| `getScheduleEntries(start, end, techIds)` | scheduleActions.ts | Fetch events for calendar |
| `getCurrentUser()` | users/actions | Get current user for time entry |
| `getCurrentTimePeriod()` | timePeriodsActions.ts | Get active billing period |
| `fetchOrCreateTimeSheet(userId, periodId)` | timeSheetActions.ts | Get/create time sheet |
| `saveTimeEntry(entry)` | timeEntryCrudActions.ts | Persist time entry |

### Existing Components (in @alga-psa/scheduling)

| Component | Purpose |
|-----------|---------|
| `DynamicBigCalendar` | Dynamic import of React Big Calendar |
| `EntryPopup` | Event creation/editing popup |
| `CalendarStyleProvider` | Calendar CSS-in-JS styling |
| `TimeEntryDialog` | Full time entry form (dialog or drawer mode) |
| `TimeEntryProvider` | Context for time entry state management |

### New Type (in @alga-psa/types)

```ts
interface TimeEntryWorkItemContext {
  workItemId: string;
  workItemType: WorkItemType;
  workItemName: string;
  ticketNumber?: string;
  interactionType?: string;
  clientName?: string | null;
  startTime?: Date;
  endTime?: Date;
  projectName?: string;
  phaseName?: string;
  taskName?: string;
  serviceId?: string | null;
  serviceName?: string | null;
  elapsedTime?: number;
  timeDescription?: string;
}
```

## Security / Permissions

- Agent schedule: respects `user_schedule:read` (own only) and `user_schedule:read:all` (view others)
- Time entry: requires active time period; shows toast/dialog if none exists
- Private schedule entries: shown as "Busy" for non-owning users

## Files to Create

| File | Package | Purpose |
|------|---------|---------|
| `packages/ui/src/context/SchedulingContext.tsx` | ui | Context definition, hook, no-op default |
| `packages/scheduling/src/components/schedule/AgentScheduleView.tsx` | scheduling | Single-agent calendar drawer |
| `packages/scheduling/src/lib/timeEntryLauncher.tsx` | scheduling | Time entry orchestration helper |
| `packages/msp-composition/src/scheduling/MspSchedulingProvider.tsx` | msp-composition | Real provider wrapping children |

## Files to Modify

| File | Change |
|------|--------|
| `packages/types/src/interfaces/scheduling.interfaces.ts` | Add `TimeEntryWorkItemContext` |
| `packages/ui/src/context/index.ts` | Re-export SchedulingContext |
| `packages/msp-composition/package.json` | Add `@alga-psa/scheduling` dep |
| `server/src/app/msp/tickets/[id]/page.tsx` | Wrap with MspSchedulingProvider |
| `server/src/app/msp/contacts/[id]/page.tsx` | Wrap with MspSchedulingProvider |
| `server/src/app/msp/contacts/[id]/activity/page.tsx` | Wrap with MspSchedulingProvider |
| `server/src/app/msp/projects/[id]/page.tsx` | Wrap with MspSchedulingProvider |
| `packages/tickets/.../AgentScheduleDrawer.tsx` | Stub → useSchedulingCallbacks() |
| `packages/tickets/.../TicketDetails.tsx` | Time entry stub → useSchedulingCallbacks() |
| `packages/clients/.../InteractionDetails.tsx` | Time entry stub → useSchedulingCallbacks() |
| `packages/projects/.../TaskForm.tsx` | Time entry stub → useSchedulingCallbacks() |

## Reference Implementations

- **Old AgentScheduleDrawer**: `git show c6e3612d2 -- packages/tickets/src/components/ticket/AgentScheduleDrawer.tsx`
- **ScheduleCalendar**: `packages/scheduling/src/components/schedule/ScheduleCalendar.tsx`
- **Old time entry handlers**: `git log --all -p -S "TimeEntryDialog" -- packages/tickets/src/components/ticket/TicketDetails.tsx`
- **TimeEntryDialog**: `packages/scheduling/src/components/time-management/time-entry/time-sheet/TimeEntryDialog.tsx`

## Acceptance Criteria

- [ ] Clicking agent name from ticket opens agent schedule calendar in drawer
- [ ] Clicking user name from interaction opens agent schedule calendar in drawer
- [ ] Calendar shows color-coded events for the agent, default week view
- [ ] Clicking "Add Time Entry" from ticket opens TimeEntryDialog with ticket context
- [ ] Clicking "Add Time Entry" from interaction opens TimeEntryDialog with interaction context
- [ ] Clicking "Add Time Entry" from project task opens TimeEntryDialog with task context
- [ ] Time entry save persists correctly and calls onComplete callback
- [ ] Missing time period shows appropriate error feedback
- [ ] Without MspSchedulingProvider, stubs degrade gracefully (alert/toast)
- [ ] No new cross-package dependencies added to tickets, clients, or projects
