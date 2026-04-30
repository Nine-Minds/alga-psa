# Workflow Designer Stacked Layout

## Problem

The workflow designer uses fixed floating panels for the action palette and properties panel. On narrow screens, the panels and the center workflow canvas compete for horizontal space, causing the center content to become cramped or obscured.

## Goal

When the designer does not have enough horizontal room for the palette, center content, and properties panel, switch from the three-column floating layout to a vertically stacked layout.

## Non-Goals

- Replace the palette or properties panel with drawers.
- Redesign the workflow pipeline, graph view, or step configuration UI.
- Change drag-and-drop behavior or workflow data behavior.

## UX Requirements

- Wide screens keep the existing floating three-panel layout.
- Narrow screens stack the designer sections in this order:
  1. Palette/actions panel
  2. Main workflow content/canvas
  3. Properties/validation panel
- The stacked breakpoint should account for the current sidebar width and palette collapsed state instead of relying only on a hard-coded viewport breakpoint.
- In stacked mode, the center content should not retain the large left/right padding used to avoid floating panels.
- In stacked mode, the properties panel should be full-width and the resize handle should be hidden/disabled.

## Acceptance Criteria

- The workflow designer automatically switches to stacked layout when available designer width is below the required width for the floating layout.
- The floating layout remains unchanged on sufficiently wide screens.
- The stacked layout uses normal document flow and avoids fixed panel overlap.
- The palette remains usable with existing drag-and-drop rendering.
- The properties panel remains usable for selected step editing and validation messages.
