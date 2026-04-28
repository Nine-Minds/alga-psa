# Scratchpad

## Decisions

- Keep both UX entry points: quick triage from Runs tab and full-page route for deep investigation/shareable links.
- Do not keep two independent detail implementations. Use `WorkflowRunDetails` as the canonical detail/action/log/audit inspector.
- Replace the Runs tab inline details card with a `Drawer` so operators can inspect runs without losing the table context.
- Add Previous/Next drawer navigation over the currently loaded `runs` array.
- Keep Run Studio's graph/pipeline as a full-page-only enhancement around the canonical inspector.

## Relevant files

- `ee/server/src/components/workflow-designer/WorkflowRunList.tsx`
- `ee/server/src/components/workflow-designer/WorkflowRunDetails.tsx`
- `ee/server/src/components/workflow-run-studio/RunStudioShell.tsx`
- `server/src/app/msp/workflows/runs/[runId]/page.tsx`
- `packages/ui/src/components/Drawer.tsx`

## Validation commands

- `cd server && npm run typecheck -- --pretty false`

## Notes

- Current branch: `feature/combine-workflow-details-run-info`.
- The workflow palette/layout PR has been merged into `origin/main` and is present in this branch.

## 2026-04-28 implementation notes

- `WorkflowRunList.tsx` now opens `WorkflowRunDetails` inside `Drawer` instead of rendering an inline card below the table.
- Drawer navigation uses the currently loaded `runs` array and updates `selectedRunId` for Previous/Next.
- Drawer includes an `Open full page` action that navigates to `/msp/workflows/runs/${runId}`.
- `RunStudioShell.tsx` was simplified substantially. It now owns only studio shell concerns: loading graph context, graph/list view toggle, refresh/polling for active runs, and admin permission lookup. Detailed run metadata/actions/logs/audit rendering is delegated to `WorkflowRunDetails`.
- Validation passed: `cd server && npm run typecheck -- --pretty false`.

## 2026-04-28 scroll fix

- Drawer preview content now has an explicit viewport-bounded scrolling container so timeline, selected step details, logs, and audit sections can be reached.
- Run Studio shell now uses a viewport-height layout with a scrollable canonical inspector column, keeping the graph column visible while details scroll independently.
- Validation passed again: `cd server && npm run typecheck -- --pretty false`.

## 2026-04-28 UI click-through results

Tested with `alga-dev` against `http://localhost:3872`.

### Full-page Workflow Run Studio checklist

- Refresh button: clicked, page remained stable and run details stayed loaded.
- Graph/List toggle: clicked List and Graph; list rendered run steps and graph rendered ReactFlow nodes.
- Graph controls: clicked zoom in, zoom out, and fit view; no visible product breakage.
- Graph/step selection: clicked a graph node and the Step Timeline View button; step details rendered.
- Step filters: opened Step status and Node type dropdowns, selected Succeeded and action.call, toggled Collapse nested blocks, then reset filters back to All statuses / All types.
- Details scroll: scrolled details column to logs and audit sections; `#workflow-run-audit-export` was reachable in viewport.
- Envelope tabs: clicked Payload, Vars, Meta, Error, Raw, then Payload again.
- Logs: typed a log search, applied, reset, selected Info level, applied, reset, and clicked Export CSV.
- Audit: scrolled to and clicked Export Audit CSV.
- Run actions: clicked Export. Opened Retry and Replay confirmation dialogs without confirming destructive actions.

### Runs tab drawer checklist

- Back to Runs page from full-page studio worked.
- Preview button opened the run preview drawer.
- Drawer showed canonical `WorkflowRunDetails` content for selected run.
- Next and Previous controls moved between loaded runs and updated the displayed run ID.
- Drawer content scroll container exposed bottom content; audit export was reachable in viewport.
- Open full page navigated from drawer to `/msp/workflows/runs/[runId]`.
- Returning to the Runs page closed the drawer and preserved the Runs view.

### Notes

- Console contained existing local-env noise about `localhost:3000/locales/en/common.json` and an Electron CSP warning.
- Radix reported a missing Dialog description warning while confirmation dialogs were open.
- ReactFlow emitted page errors after synthetic `alga-dev browser-press-key Escape` calls; this appears tied to the automation key event target rather than normal click-through behavior. Future testing should close dialogs via their Cancel buttons instead of synthetic Escape.

## 2026-04-28 UI once-over fixes

- Fixed the confirmation dialog accessibility warning by ensuring `ConfirmationDialog` always renders a `DialogDescription` for Radix.
- Adjusted `DialogDescription` to accept a custom class so confirmation dialogs can provide an sr-only description without adding duplicate visible text.
- Improved `WorkflowRunDetails` header layout: run ID now wraps/breaks safely and action buttons wrap instead of running off the right edge.
- Added horizontal scrolling/min widths for the Step Timeline and Audit Trail tables.
- Improved log filter/action layout so Apply/Reset/Export CSV wrap and align better in constrained widths.
- Rechecked full-page and drawer layouts with `alga-dev`; visible buttons stayed within viewport bounds and bottom sections remained reachable by scrolling.
- Reopened Retry dialog after the accessibility change and saw no new missing-description console warning.
- Validation passed again: `cd server && npm run typecheck -- --pretty false`.

## 2026-04-28 visual grid button placement pass

- Moved run action buttons into a full-width toolbar below the run identity block so they no longer crowd or clip against the right edge of the header.
- Reduced header action buttons to `size="sm"` for better density in drawer/full-page contexts.
- Reworked Step Timeline controls into a simple two-column filter grid with the collapse toggle on its own row, avoiding the previous baseline mismatch beside select controls.
- Reworked Run Logs controls so Search and Level occupy the filter row and Apply/Reset/Export CSV sit together in a single right-aligned toolbar row.
- Rechecked element bounds with `alga-dev`; key controls are within the viewport and aligned more consistently.
- Validation passed: `cd server && npm run typecheck -- --pretty false`.

## 2026-04-28 step timeline row-click improvement

- Made Step Timeline rows clickable and keyboard-activatable (`Enter`/`Space`) so users do not need to horizontally scroll to the View button on narrower screens.
- Preserved the View button for explicit affordance and stopped propagation so clicking it does not double-handle the row click.
- Verified via `alga-dev` that timeline rows expose `role="button"` and clicking a row selects/opens step details.
- Validation passed: `cd server && npm run typecheck -- --pretty false`.

## 2026-04-28 audit trail DataTable + user display

- Changed the Workflow Run Details Audit Trail from a custom `Table` to the shared `DataTable` component.
- Added audit-user lookup through `getAllUsersBasic(true)` for admins and display user full name plus email/username instead of raw `user_id` when available.
- Kept a safe fallback for system/unknown users.
- Verified with `alga-dev` that the audit table renders via the datatable container and shows a human-readable user (`Paula Policy Admin`, `glinda@emeraldcity.oz`) instead of only the UUID.
- Validation passed: `cd server && npm run typecheck -- --pretty false`.

## 2026-04-28 step timeline DataTable

- Changed the Step Timeline from custom `Table` components to the shared `DataTable` component.
- Preserved whole-row click behavior through `DataTable` `onRowClick`, so users can select a step without horizontally scrolling to the View button.
- Kept the explicit View action as the standard action column.
- Set non-paginated DataTables to use a page size matching loaded rows so Step Timeline and Audit Trail do not silently show only the first 10 rows.
- Verified with `alga-dev` that the Step Timeline renders as a datatable and clicking a row updates the selected `step` URL param.
- Validation passed: `cd server && npm run typecheck -- --pretty false`.

## 2026-04-28 run logs DataTable

- Changed Run Logs from custom `Table` components to the shared `DataTable` component.
- Preserved log filtering, reset, export, and load-more behavior.
- Set non-paginated log DataTable page size to the loaded log count so loaded logs are not truncated to the default page size.
- Verified with `alga-dev` that Run Logs renders as a datatable container.
- Validation passed: `cd server && npm run typecheck -- --pretty false`.
