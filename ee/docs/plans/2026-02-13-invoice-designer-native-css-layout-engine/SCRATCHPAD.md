# SCRATCHPAD — Invoice Designer Native CSS Layout Engine

## Context

Goal: remove bespoke geometry math in the invoice designer and rely on native browser layout (CSS flex/grid + box model). Replace custom drop-parent resolution with `@dnd-kit/core` DOM-driven collision detection.

## Target Deletions

- `packages/billing/src/components/invoice-designer/utils/constraintSolver.ts`
- `packages/billing/src/components/invoice-designer/utils/constraints.ts`
- `packages/billing/src/components/invoice-designer/utils/dropParentResolution.ts`
- `packages/billing/src/components/invoice-designer/utils/aspectRatio.ts`

## Decisions

- Prefer CSS-first semantics even if it means removing some legacy constraint behaviors.
- Drag-drop should be based on DOM geometry via dnd-kit collision detection (not custom math).
- Use CSS `aspect-ratio` for images. Avoid JS measurement loops.
- Scope decisions (2026-02-13):
  - Layout modes: flex + grid.
  - Resizing: enabled via CSS sizing props.
  - Snapping: edge + grid snapping as discrete insertion behavior.

## Detailed Decisions

- Resizing:
  - Drag handles: `image`, `section`, `stack`.
  - No drag-resize for: `text`, `field`, `divider`, `totals`, `table`, `dynamic-table`.
  - No table column resizing.
  - Drag writes pixel sizing only (`px`). Non-px sizing can be entered via the property panel.
  - Flex main-axis resize should prefer `flex-basis` updates.
- Nesting allowlist:
  - Containers: `document`, `section`, `stack`, `grid` (if a node/type exists).
  - Leaves: `text`, `field`, `image`, `divider`, `totals`, `table`, `dynamic-table`.
- Drag-drop persistence:
  - Persist only `targetContainerId` + `insertionIndex` state changes. No coordinate-based persistence.
- "Basic snapping" definition:
  - Flex: snap to before/after sibling insertion indices.
  - Grid: snap to deterministic cell/index insertion based on grid tracks, not arbitrary pixel coordinates.

## Implemented

- 2026-02-13: `F001` CSS-first layout model
  - New node model fields in `packages/billing/src/components/invoice-designer/state/designerStore.ts`:
    - `node.layout`: `display: flex|grid` + flex/grid properties in CSS semantics.
    - `node.style`: width/height/min/max, flex item props, media props (aspectRatio/objectFit).
  - Removed constraint-solver state from the store snapshot and APIs (constraints are no longer part of `exportWorkspace()`).
  - Updated presets to accept legacy layout shapes while mapping them into CSS layout at insertion time:
    - `packages/billing/src/components/invoice-designer/constants/presets.ts`
    - `packages/billing/src/components/invoice-designer/state/designerStore.ts`
  - Deleted the constraints inspector tests and removed constraints UI from `packages/billing/src/components/invoice-designer/DesignerShell.tsx`.

- 2026-02-13: `F002` Layout/style -> DOM style mapping for canvas
  - New mapping helpers:
    - `packages/billing/src/components/invoice-designer/utils/cssLayout.ts`
  - Canvas applies mapped styles:
    - `packages/billing/src/components/invoice-designer/canvas/DesignCanvas.tsx`
      - outer node: uses `node.style` for width/height/min/max/flex props, still absolute-positioned during cutover
      - container child wrapper: uses `node.layout` to set `display`, flex/grid rules, `gap`, `padding`

- 2026-02-13: `F003` Flex row/column container layout
  - Children of flex/grid containers are now rendered as flow items (no absolute `top/left`), enabling native flex row/column layout:
    - `packages/billing/src/components/invoice-designer/canvas/DesignCanvas.tsx`
  - Child ordering uses `parent.childIds` when parent is `display:flex|grid` (stable authored order); legacy canvas containers remain position-sorted for now.

- 2026-02-13: `F004` Spacing controls (gap/padding + border via existing presets)
  - Updated Inspector layout panel to edit `gap` and `padding` (px) and flex alignment using CSS semantics:
    - `packages/billing/src/components/invoice-designer/DesignerShell.tsx`
  - `resolveFlexPadding` updated to support both legacy numeric padding and CSS `padding: \"Npx\"` during cutover:
    - `packages/billing/src/components/invoice-designer/utils/layout.ts`

## Remaining Design Choices

- Collision strategy and snapping thresholds are intentionally selected to minimize custom geometry logic:
  - Collision detection:
    - Use `pointerWithin` first (deepest eligible droppable under cursor).
    - Fallback to `closestCenter` if pointer is not within any droppable.
    - Configure measuring to keep DOM rects fresh during drag.
  - Sensors and overlay:
    - `PointerSensor` with activation distance (e.g. 6px).
    - `DragOverlay` to avoid layout reflow while dragging.
  - Sorting strategies:
    - Flex column: `verticalListSortingStrategy`
    - Flex row: `horizontalListSortingStrategy`
    - Grid: `rectSortingStrategy`
  - Snapping threshold behavior:
    - Flex uses midpoint rule on hovered rect (before/after) for insertion indicators.
    - Grid uses sortable `over` resolution directly (deterministic cell/index).

## Implementation Sketch (Non-binding)

- Introduce a single "layout props -> style props" mapping function used by:
  - designer canvas rendering
  - preview rendering (if different)
  - AST export (if relevant)
- Add dnd-kit:
  - sensors: pointer + keyboard (optional)
  - sortable contexts for sibling reordering
  - collision detection tuned for nested containers
- Enforce nesting rules in drop handler (reject invalid parent).
- Remove legacy util usage, then delete files.

## Useful Commands

- Search for legacy geometry imports:
  - `rg -n \"constraintSolver|constraints|dropParentResolution|aspectRatio\" packages/billing/src/components/invoice-designer`

## Repo/Test Gotchas (Discovered 2026-02-13)

- Vitest + React tests were failing when `NODE_ENV=production` leaked into the test process (React test utils expect non-production builds).
  - Fix: `server/vitest.globalSetup.js` now forces `process.env.NODE_ENV = 'test'`.
- Package tests under `../packages/**` were not being discovered when running Vitest from `server/`.
  - Fix: `server/vitest.config.ts` now includes `../packages/**/*.{test,spec}.*` explicitly.
- Coverage provider version must match Vitest major version.
  - `server/` is currently on `vitest@3.2.4`, so `@vitest/coverage-v8@3.2.4` is added to `server/package.json` to avoid resolving the repo-root `@vitest/coverage-v8@4.x`.
