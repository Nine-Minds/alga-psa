# PRD — Invoice Designer Native CSS Layout Engine (Flex/Grid + dnd-kit)

- Slug: `invoice-designer-native-css-layout-engine`
- Date: `2026-02-13`
- Status: Planned
- Depends on: `ee/docs/plans/2026-02-12-invoice-template-json-ast-renderer-cutover/`

## Summary

Replace the invoice designer's custom geometry and constraint-math layout engine with native browser layout (CSS Flexbox/Grid + standard CSS features like `aspect-ratio`). Replace custom drop-parent resolution math with `@dnd-kit/core` collision detection based on DOM measurements.

The designer should map layout intent to CSS rules, and let the browser compute sizes, alignment, and bounding boxes.

## Problem

Current designer behavior relies on a custom coordinate/constraint system for:

- drop target resolution and nesting decisions
- spatial constraints and edge case math
- aspect ratio enforcement
- manual layout calculations

This creates high maintenance cost, hard-to-debug geometry bugs, and divergence from how invoices render in the real HTML/CSS world.

## Insight

All spatial constraints, aspect ratios, and grid layouts are special cases of the browser's native layout engine.

## Goals

- Represent layout properties in the designer as native CSS semantics (flex/grid/box model).
- Compute all layout and bounding boxes using DOM layout, not custom math.
- Use `@dnd-kit/core` collision detection for drop placement and nesting.
- Preserve or improve current designer UX for:
  - dragging nodes
  - reordering nodes in a container
  - moving nodes across containers
  - resizing nodes (where supported)
  - aspect ratio for images and fixed-ratio blocks
- Keep designer preview output consistent with invoice rendering output (HTML/CSS).
- Delete the custom geometry/constraint layers listed below.

## Non-goals

- Building a full “Figma-like” layout engine (guides, autolayout inference, advanced snapping).
- Supporting arbitrary custom physics/geometry behavior in drag-drop.
- Reworking unrelated invoice-template AST or billing flows beyond the designer canvas/layout editing.

## Users and Primary Flows

Primary personas:

- Billing admins composing invoice layout in the visual designer.
- Implementers maintaining the designer and renderer.

Primary flows:

1. Drag a node into a container
2. Reorder nodes within a container
3. Move a node between containers
4. Adjust container layout mode (column/row/grid) and spacing
5. Set sizing constraints using CSS primitives (width, min/max, flex, grid)
6. Enforce aspect ratio for images (and optionally other nodes)
7. Preview invoice output using the same HTML/CSS semantics used for rendering/PDF

## UX / UI Notes

- Replace “constraint” concepts with a “Layout” panel that edits CSS-like properties.
- Layout modes:
  - Stack (flex column/row)
  - Grid (CSS grid)
  - Freeform/absolute positioning is out of scope
- Expose a small, safe subset of properties first:
  - container: direction, gap, align, justify, padding, border
  - item: width/height, min/max, flex grow/shrink/basis
  - grid: columns (template), rows (template), auto-flow, gap
  - image: `aspect-ratio` and `object-fit`
- Drop indicators should be based on DOM geometry (closest edges, insertion index).
- Snapping:
  - edge snapping within a container (before/after insertion positions)
  - grid snapping when a parent container is in grid mode

### Interaction Semantics

- Resizable node types (by drag handles):
  - `image`
  - container blocks: `section`, `stack`
- Non-resizable by drag handles (size naturally; configurable via spacing/layout):
  - `text`, `field`, `divider`, `totals`, `table`, `dynamic-table`
  - No table column resizing.
- Resize units:
  - Drag handles update pixel values only (e.g. `width: 320px`, `height: 180px`, `flex-basis: 240px`).
  - The property panel may accept CSS strings (e.g. `%`, `rem`, `auto`) for advanced control.
  - For flex children, resizing along the main axis should prefer `flex-basis` over `width`/`height`.
- Nesting model:
  - Containers (droppable-into): `document`, `section`, `stack`, `grid` (if represented as a node/type).
  - Leaf nodes (droppable-between only): `text`, `field`, `image`, `divider`, `totals`, `table`, `dynamic-table`.
- Drag-drop is discrete, not coordinate-based:
  - Drop resolves to `targetContainerId` + `insertionIndex` (no "drop at x,y" semantics).
- Basic snapping definition:
  - Flex: snap to before/after sibling insertion indices.
  - Grid: snap to a deterministic cell/index insertion derived from grid tracks, not arbitrary pixel snapping.

## Requirements

### Functional Requirements

- Canvas layout should be computed by CSS (flex/grid), not custom math utilities.
- Each designer node type that participates in layout must have a deterministic mapping:
  - Designer layout state -> DOM element style -> rendered geometry
- Drag/drop must use `@dnd-kit/core` with collision detection derived from DOM measurements.
- Drop-parent resolution must support:
  - inserting before/after siblings
  - nesting into eligible containers
  - rejecting invalid drop targets with clear UX
- Resizing (if present today) should rely on DOM measurement + CSS properties (not constraint solving).
- Aspect ratio enforcement must use CSS `aspect-ratio` (and/or intrinsic image sizing), not JS math.
- Snapping must be discrete (insertion/cell selection), not freeform coordinate snapping.
- Drag-drop implementation guidance:
  - Prefer `@dnd-kit/sortable` for within-container ordering and insertion-index snapping.
  - Collision detection:
    - Use `pointerWithin` first (select the deepest eligible droppable under the cursor).
    - Fallback to `closestCenter` when the pointer is not within any droppable (fast drags / overlays).
    - Use dnd-kit measuring configured to keep rects fresh during drag (avoid stale geometry in nested layouts).
  - Sensors and overlays:
    - Use `PointerSensor` with an activation distance (e.g. 6px) to avoid accidental drags.
    - Use `DragOverlay` so dragging does not reflow layout.
  - Sorting strategies:
    - Flex column: `verticalListSortingStrategy`
    - Flex row: `horizontalListSortingStrategy`
    - Grid: `rectSortingStrategy`
  - Snapping thresholds:
    - Flex insertion uses the midpoint rule on the hovered item's rect (before/after); avoid additional pixel snapping math.
    - Grid insertion uses the sortable `over` resolution directly (deterministic cell/index selection).
- The delete list modules must be removed from the runtime dependency graph:
  - `utils/constraintSolver.ts`
  - `utils/constraints.ts`
  - `utils/dropParentResolution.ts`
  - `utils/aspectRatio.ts`
- `utils/layout.ts` should be reduced to lightweight mapping/helpers, not geometry solvers.

### Non-functional Requirements

- Behavior should remain stable across preview and PDF (headless Chromium) since both are HTML/CSS.
- Drag-drop interactions should remain responsive for typical template sizes (tens to low hundreds of nodes).
- Errors should be surfaced as structured, actionable messages (invalid container, invalid nesting, etc.).

## Deleted / Eliminated Layers

- `packages/billing/src/components/invoice-designer/utils/constraintSolver.ts`
- `packages/billing/src/components/invoice-designer/utils/constraints.ts`
- `packages/billing/src/components/invoice-designer/utils/dropParentResolution.ts`
- `packages/billing/src/components/invoice-designer/utils/aspectRatio.ts`

And eliminate “thousands of lines” of bespoke coordinate math and geometry edge cases.

## Rollout / Migration

- No tenant templates require migration (no custom templates in production yet).
- Internal-only cutover is acceptable as long as parity holds for the “standard templates” designer output.

## Risks

- CSS semantics may not exactly match legacy constraint behavior for edge cases.
- Drag-drop collision strategies can change perceived drop target behavior; needs UX tuning.
- Print/PDF layout differences vs. in-app preview if the preview container differs (scale, margins).

## Acceptance Criteria (Definition of Done)

- [ ] Designer canvas uses DOM layout (flex/grid) for geometry; no constraint solver usage.
- [ ] Drag/drop uses `@dnd-kit/core` and supports reorder + cross-container move + nesting.
- [ ] Aspect ratio uses CSS `aspect-ratio` for images (and any other nodes requiring it).
- [ ] Resizing works using CSS sizing props (width/height/min/max/flex/grid), with no constraint solving.
- [ ] Snapping works (edge snapping for insertion/reorder and grid snapping for grid containers).
- [ ] Nesting rules are enforced via an explicit allowlist and covered by automated tests.
- [ ] Drag-drop resolves to container + insertion index only (no coordinate persistence).
- [ ] Removed modules are deleted and no longer referenced.
- [ ] Visual designer output renders consistently with the invoice renderer (HTML/CSS preview parity).
- [ ] Automated tests cover drag-drop behaviors, nesting rules, and deletion of legacy utilities.
