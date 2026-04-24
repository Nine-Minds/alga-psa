# Scratchpad

## Decisions

- Use a computed stacked breakpoint instead of a fixed CSS breakpoint.
- Required floating width includes palette width, sidebar width, center minimum width, floating offsets, and center padding extras.
- Preserve the existing floating layout on wide screens.
- Stack order: palette/actions, main workflow content, properties/validation.
- Use `display: contents` on the existing floating wrapper in stacked mode so the palette, center content, and sidebar can participate as ordered flex items without duplicating the Droppable/sidebar markup.
- In stacked mode, force palette and sidebar flex items to `flex-none`; otherwise the palette can shrink to zero height and visually overlap the center content.

## Relevant Files

- `ee/server/src/components/workflow-designer/WorkflowDesigner.tsx`
- `ee/server/src/components/workflow-designer/WorkflowDesignerPalette.tsx`
- `ee/server/src/components/workflow-designer/WorkflowDesignerPalette.module.css`
- `ee/server/src/components/workflow-designer/workflowDesignerSidebarSizing.ts`

## Implementation Notes

- Added `DESIGNER_CENTER_MIN_WIDTH = 640` and derive `isStacked` from current palette width, resized sidebar width, center minimum width, and layout spacing.
- Stacked mode switches the anchor to a single vertical scroll container.
- Stacked mode clears center-scroll inline padding, makes the sidebar full-width, and disables the sidebar resize handle.
- `WorkflowDesignerPalette` now accepts `layout` and `className` props so it can become full-width in stacked mode while preserving floating sizing by default.
- Added stacked-only palette CSS so the palette card has real height in normal flow, scrolls internally to 20rem, and collapses to a compact 40px row without leaving a large blank gap.

## Alga Dev Ground Truth

Target browser pane: `38155ff4-221b-444a-9e4d-f06676dfb19d`, URL `http://localhost:3226/msp/workflow-editor/8dc9052e-1408-4f03-8b48-b308602489e1`.

Observed viewport: `935x973`, which correctly triggers stacked mode.

Screenshots captured:

- `/var/folders/8g/3xyjqdpd4hx2h39h4qb2lyvm0000gn/T/ghostty-pane-ide/screenshots/workflow-stacked-cleaned-expanded.png`
- `/var/folders/8g/3xyjqdpd4hx2h39h4qb2lyvm0000gn/T/ghostty-pane-ide/screenshots/workflow-stacked-collapsed-fixed-after-click.png`
- `/var/folders/8g/3xyjqdpd4hx2h39h4qb2lyvm0000gn/T/ghostty-pane-ide/screenshots/workflow-stacked-sidebar-visible.png`

DOM measurements after cleanup:

- Expanded palette: palette rect `608x381`, center starts at palette bottom, no overlap.
- Collapsed palette: palette row rect `608x40`, center starts below it, no large blank area.
- Sidebar: rect `640x539`, `position: relative`, `width: 100%`, resize handle has `pointer-events: none` and `opacity: 0`.

## Validation Notes

- `npm --prefix ee/server run typecheck -- --pretty false` passed.
- `npm --prefix ee/server run lint -- --file ...` failed because this repo's `next lint` command does not support `--file`.
- `npx eslint ee/server/src/components/workflow-designer/WorkflowDesigner.tsx ee/server/src/components/workflow-designer/WorkflowDesignerPalette.tsx` completed with 0 errors and existing warnings in `WorkflowDesigner.tsx`.
- `git diff --check` passed before Alga Dev cleanup; rerun before handoff if additional edits are made.
