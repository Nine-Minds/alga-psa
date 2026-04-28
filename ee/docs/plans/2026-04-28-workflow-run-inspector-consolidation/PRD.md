# Workflow Run Inspector Consolidation

## Problem

Workflow run inspection is split across two overlapping implementations: the Runs tab inline details panel and the full-page Run Studio. They fetch and render much of the same run metadata, step state, logs, audit history, and run actions independently. This creates duplicate maintenance work and makes it likely that users see different capabilities depending on how they open a run.

## Goals

- Preserve two useful user contexts:
  - quick triage from the Runs tab without losing filters/table context
  - a shareable full-page run route for deeper investigation
- Replace the inline under-table detail panel with a right-side drawer optimized for quick triage.
- Allow users, especially admins working through queues, to move to the previous/next visible run from the drawer.
- Consolidate the detailed run inspection UI so the drawer and full-page route use the same canonical detail component for run metadata, actions, steps, logs, and audit details.
- Keep the full-page route available and retain the graph/pipeline visualization as a studio-only enhancement.

## Non-goals

- Changing workflow run database schema or action APIs.
- Adding new workflow run actions.
- Reworking the Runs tab filtering model.
- Building a brand-new graph visualization.
- Changing permissions beyond reusing existing `canAdmin` and current run action checks.

## Target users and flows

### MSP operator / admin quick triage

1. Open Workflow Control Panel > Runs.
2. Apply filters or sort the visible run table.
3. Click a run's Preview/Details action.
4. A drawer opens on the right with the canonical run detail view.
5. Use Previous/Next to move through visible runs without closing the drawer.
6. Use Open full page when deeper graph-oriented debugging is needed.

### Deep investigation / shareable route

1. Open `/msp/workflows/runs/[runId]` from a run ID, external link, or drawer action.
2. See the Run Studio shell with graph/pipeline context plus the canonical run detail inspector.
3. Perform the same run actions and inspect the same logs/audit/step details as the drawer.

## UX notes

- The Runs tab should no longer insert a large details card under the table.
- The drawer should use the shared `Drawer` component and a wide responsive width suitable for dense diagnostics.
- The row action label should communicate quick triage, e.g. `Preview` or `Details`.
- The run ID link should continue to navigate to the full-page route.
- The drawer header/navigation should include Previous, Next, Open full page, and Close affordances.
- Previous/Next operate over the currently loaded `runs` array in the table.

## Integration notes

- Existing action APIs from `@alga-psa/workflows/actions` should continue to be used.
- `WorkflowRunDetails` is the current richest reusable detail component and should become the canonical inspector surface used by both the drawer and Run Studio.
- `RunStudioShell` should become more of a shell/layout around studio-only graph context plus the canonical detail inspector.

## Acceptance criteria

- Runs tab opens run details in a drawer instead of an inline card below the table.
- Drawer can navigate to previous/next loaded run and updates selected row state.
- Drawer provides an Open full page action for the selected run.
- Full-page run route still works at `/msp/workflows/runs/[runId]`.
- Full-page route uses the same canonical detail component as the drawer for detail/actions/log/audit content.
- Existing run action buttons continue to typecheck and render with unique IDs.
- `cd server && npm run typecheck -- --pretty false` passes.

## Risks and mitigations

- **Large component duplication:** Mitigate by keeping the canonical detail component intact and making Run Studio compose it instead of duplicating detail panels.
- **Drawer too narrow for diagnostics:** Use a wide drawer width and preserve internal scrolling.
- **Navigation ambiguity:** Keep run ID as full-page navigation and use row action for quick drawer triage.
