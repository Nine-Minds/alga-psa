# Scratchpad — Scheduling Context Facade

- Plan slug: `scheduling-context-facade`
- Created: `2026-02-05`

## Decisions

- (2026-02-05) Use React Context facade pattern instead of direct imports or prop threading. Reason: avoids cross-package deps AND avoids 3-4 layer prop threading for InteractionDetails/TaskForm.
- (2026-02-05) Context defined in `@alga-psa/ui` (all packages already depend on it). Real implementations in `@alga-psa/scheduling`. Provider in `msp-composition`.
- (2026-02-05) Option A for server page wrapping: wrap individual pages (tickets, contacts, projects), not the MSP layout. Keeps blast radius small.
- (2026-02-05) AgentScheduleView defaults to week view (not month). Better UX for drawer width.
- (2026-02-05) AgentScheduleView lives in scheduling package (not tickets). It uses scheduling internals directly — no cross-package concern since it's in the same package.
- (2026-02-05) Yesterday's materials drawer used direct @alga-psa/billing dependency — user noted this was architecturally incorrect and should also use facade pattern in the future.

## Discoveries / Constraints

- (2026-02-05) Old AgentScheduleDrawer was 632 lines (commit c6e3612d2). Full React Big Calendar with drag-and-drop, event CRUD, color-coded events, EntryPopup integration.
- (2026-02-05) Current ScheduleCalendar.tsx has NO props (fully self-contained, 1040 lines). Cannot be embedded in a drawer as-is.
- (2026-02-05) Old time entry handlers: validated prerequisites → fetched time period → created timesheet → built IExtendedWorkItem → opened TimeEntryDialog in drawer.
- (2026-02-05) InteractionDetails is 3 layers deep from server page (ContactDetailsView → InteractionsFeed → InteractionDetails). No existing composition wrapper for clients.
- (2026-02-05) TaskForm is 4 layers deep (ProjectPage → ProjectDetail → TaskQuickAdd/TaskEdit → TaskForm). No existing composition wrapper for projects.
- (2026-02-05) TagContext is a good pattern reference — context defined in package, provides callbacks to deeply nested consumers.
- (2026-02-05) InteractionDetails already imports AgentScheduleDrawer from @alga-psa/tickets, so updating the stub there fixes both ticket and interaction entry points.
- (2026-02-05) TimeEntryDialog supports `inDrawer: true` prop for drawer mode.
- (2026-02-05) Timer state (elapsedTime, isRunning, timeDescription) is local to TicketDetails — passed through context params, not stored in the context itself.

## Commands / Runbooks

- View old AgentScheduleDrawer: `git show c6e3612d2 -- packages/tickets/src/components/ticket/AgentScheduleDrawer.tsx`
- View old time entry handlers: `git log --all -p -S "TimeEntryDialog" -- packages/tickets/src/components/ticket/TicketDetails.tsx | head -200`
- The modularization commit: `c43321e4c` ("refactor: continue modularization of actions and components")

## Links / References

- Old AgentScheduleDrawer styles: `packages/tickets/src/components/ticket/AgentScheduleDrawerStyles.tsx`
- ScheduleCalendar: `packages/scheduling/src/components/schedule/ScheduleCalendar.tsx`
- EntryPopup: `packages/scheduling/src/components/schedule/EntryPopup.tsx`
- DynamicBigCalendar: `packages/scheduling/src/components/schedule/DynamicBigCalendar.tsx`
- CalendarStyleProvider: `packages/scheduling/src/components/schedule/CalendarStyleProvider.tsx`
- TimeEntryDialog: `packages/scheduling/src/components/time-management/time-entry/time-sheet/TimeEntryDialog.tsx`
- TimeEntryProvider: `packages/scheduling/src/components/time-management/time-entry/time-sheet/TimeEntryProvider.tsx`
- scheduleActions: `packages/scheduling/src/actions/scheduleActions.ts`
- timeEntryCrudActions: `packages/scheduling/src/actions/timeEntryCrudActions.ts`
- MspTicketDetailsContainerClient: `packages/msp-composition/src/tickets/MspTicketDetailsContainerClient.tsx`
- Existing stubs: AgentScheduleDrawer.tsx, TicketDetails.tsx:975, InteractionDetails.tsx:229, TaskForm.tsx:831

## Open Questions

- None currently blocking.

## Updates

- (2026-02-05) Added TimeEntryWorkItemContext to `packages/types/src/interfaces/scheduling.interfaces.ts` for shared work-item launch context.
- (2026-02-05) Added `SchedulingContext` in `packages/ui/src/context/SchedulingContext.tsx` with no-op defaults and hook.
- (2026-02-05) Re-exported `SchedulingContext` from `packages/ui/src/context/index.ts`.
- (2026-02-05) Created `packages/scheduling/src/components/schedule/AgentScheduleView.tsx` and `AgentScheduleDrawerStyles.tsx` for single-agent calendar drawer view.
- (2026-02-05) AgentScheduleView now loads entries via `getScheduleEntries` scoped to agentId and current date range.
- (2026-02-05) AgentScheduleView uses DynamicBigCalendar with week/day/month views and default week view.
- (2026-02-05) AgentScheduleView applies work-item color mapping via eventPropGetter.
- (2026-02-05) AgentScheduleView opens EntryPopup on event click (view-only mode).
- (2026-02-05) AgentScheduleView auto-scrolls to 8 AM on initial render.
- (2026-02-05) AgentScheduleView gates viewing by user_schedule permissions and shows a permission error when disallowed.
- (2026-02-05) AgentScheduleView includes CalendarStyleProvider and AgentScheduleDrawerStyles for drawer styling.
- (2026-02-05) Added `packages/scheduling/src/lib/timeEntryLauncher.tsx` to orchestrate time entry dialog launch from work-item context.
- (2026-02-05) timeEntryLauncher now toasts when no active time period exists.
- (2026-02-05) timeEntryLauncher opens TimeEntryDialog in drawer mode with time period and time sheet context.
- (2026-02-05) timeEntryLauncher saves time entry, closes drawer, and triggers onComplete on success.
