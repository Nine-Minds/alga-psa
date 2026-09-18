# Visual confirmation when creating a task from a ticket — implementation plan

## Goal

After a user creates a new task from a ticket (via the "Create Task" flow on a
ticket), show a clear success toast so the user knows the task was created
successfully. Scope: v1.5.0, web app only.

## Current behavior and constraints

- `packages/projects/src/components/CreateTaskFromTicketDialog.tsx` is the entry
  point. Its "Create Task" button opens a project/phase/status picker dialog; on
  confirm it calls `openDrawer(...)` with a `<TaskQuickAdd>` drawer, passing
  `onTaskAdded={() => null}` — the success callback is a **no-op**.
- `packages/projects/src/components/TaskQuickAdd.tsx` calls `onTaskAdded(resultTask)`
  from `handleSubmit` in create mode (line 58) once `TaskForm` submits. The drawer
  is closed by `TaskForm`'s `onClose`; creation success today gives no feedback.
- The app-wide toast is `react-hot-toast` (root `<ThemedToaster/>` in
  `packages/ui/src/components/ThemedToaster.tsx`; `import { toast } from
  'react-hot-toast'` + `toast.success(...)` is the established pattern, e.g.
  `project-templates/TemplateDetail.tsx`, `TemplateStatusManager.tsx`).
- `onTaskAdded` is called with `IProjectTask | null`. It is only non-null on a
  successful create, so the toast must fire only when `resultTask` is truthy.
- The dialog's i18n uses namespace `features/projects` with keys under
  `dialogs.createTaskFromTicket.*`. New copy should follow that namespace.

## Design

### 1. Wire a real `onTaskAdded` in `CreateTaskFromTicketDialog.tsx`

Replace the no-op `onTaskAdded={() => null}` (line 169) with a handler that:

1. Calls `closeDrawer()` (already wired via `onClose={closeDrawer}`) so the
   drawer closes exactly as it does today.
2. If `resultTask` is truthy, fires
   `toast.success(t('dialogs.createTaskFromTicket.createdSuccess', 'Task created successfully'))`.
   Do not fire anything on `null` (cancelled/aborted submit).

### 2. i18n copy

Add one key to the `features/projects` locale file (en):
`dialogs.createTaskFromTicket.createdSuccess` → `"Task created successfully"`.
Keep the fallback string inline in the call for other locales.

### 3. Deliberately NOT doing

- No changes to `TaskQuickAdd`, `TaskForm`, or the ticket integration layer —
  the toast is a consumer-side concern.
- No success state beyond the toast (no inline banner, no navigation change).
- No change to the existing error toasts/`handleError` paths in this dialog.
- No mobile app changes.
- No confirmation dialog changes.

## Verification

- Existing unit test `packages/projects/src/components/__tests__/CreateTaskFromTicketDialog.test.tsx`
  should still pass (it asserts prefill mapping; add a case that a truthy
  `resultTask` produces a success toast and a `null` result does not).
- Manual smoke on the ticket detail view: Create Task → pick project/phase/status →
  Create → drawer closes and a success toast appears; canceling the drawer shows no toast.
