# SCRATCHPAD — Invoice Designer Unified Component AST

## Context

Goal: collapse designer state into a unified generic node tree so adding new properties (for example `borderRadius`) is mostly schema work, not store plumbing.

This plan intentionally continues the simplification arc:

1. Templates are data (`templateAst` JSON) not code/WASM.
2. Layout math is delegated to the DOM/CSS engine (flex/grid + dnd-kit).
3. Designer state becomes a single generic AST with schema-driven editing.

## Current State (Starting Point)

- Designer store uses `DesignerNode[]` with typed fields:
  - `position`, `size`, `parentId`, `childIds`, `allowedChildren`, `layout`, `style`, `metadata`, etc.
- Property editing is largely hardcoded in `packages/billing/src/components/invoice-designer/DesignerShell.tsx`.
- Nesting rules are defined in `packages/billing/src/components/invoice-designer/state/hierarchy.ts`.
- Palette metadata defaults live in `packages/billing/src/components/invoice-designer/constants/componentCatalog.ts`.

## Decisions (Implementation Choices That Minimize Trouble)

- Source of truth for hierarchy is `children` arrays only.
  - Do not persist `parentId` (redundant and easy to desync).
  - Parent lookup is derived when needed (tree sizes are small enough for O(n) searches).
- Patch API uses dot-notation paths (for example `style.width`, `metadata.bindingKey`) rather than JSON Pointer to keep call sites readable.
  - Internally, patch operations should be applied immutably (structural sharing).
  - This patch API is a hard requirement for the strategy: without it, the refactor cost is paid without getting the “new prop = schema change” velocity gain.
- Component schema becomes the single source of truth for:
  - palette labels/descriptions/categories
  - defaults (initial props)
  - editable props schema (inspector UI)
  - allowed parents/children (nesting rules)
- Inspector will support a small set of core field widgets plus opt-in custom widgets for complex objects/arrays (tables).

## Notes / Gotchas

- Ensure history/undo remains stable:
  - Either snapshot `nodesById + rootId` per commit, or store patches and replay.
  - Snapshotting is simpler and aligns with current approach; patch replay is smaller but more error-prone.
- Some existing code expects `allowedChildren` to be present on nodes; that must become a derived selector from schema.
- Export/import to invoice-template AST needs a single authoritative mapping; avoid letting schema defaults leak into exported templates unexpectedly.

## File Targets (Likely Touchpoints)

- Store:
  - `packages/billing/src/components/invoice-designer/state/designerStore.ts`
- Hierarchy rules removal:
  - `packages/billing/src/components/invoice-designer/state/hierarchy.ts` (delete)
- Component schema/catalog:
  - `packages/billing/src/components/invoice-designer/constants/componentCatalog.ts` (likely merged into or replaced by schema module)
- Inspector refactor:
  - `packages/billing/src/components/invoice-designer/DesignerShell.tsx`
- Canvas rendering:
  - `packages/billing/src/components/invoice-designer/canvas/DesignCanvas.tsx`
- Workspace AST mapping:
  - `packages/billing/src/components/invoice-designer/ast/workspaceAst.ts`

## Validation Runbook (When Implementing)

- Tree invariants:
  - every child id exists in `nodesById`
  - no cycles (walk from root and track visited)
  - all nodes are reachable from root (or explicitly allow unattached nodes, but prefer not to)
- Quick grep for legacy references:
  - `rg -n "parentId|allowedChildren|updateNodeStyle\\(|updateNodeLayout\\(|updateNodeMetadata\\(" packages/billing/src/components/invoice-designer -S`

## Progress Log

- 2026-02-13: Implemented unified AST type definitions in `packages/billing/src/components/invoice-designer/state/designerAst.ts`:
  - `DesignerAstNode` with `{ id, type, props, children }`
  - `DesignerAstWorkspace` with `{ rootId, nodesById }`
  - Stable document root id constant: `DESIGNER_AST_DOCUMENT_ID = 'designer-document-root'`
- 2026-02-13: Added canonical indexing to the designer store state in `packages/billing/src/components/invoice-designer/state/designerStore.ts`:
  - Store state now includes `rootId` and `nodesById` kept in sync with the existing `nodes` array via a `setWithIndex` wrapper.
  - This is an incremental cutover step so downstream UI/tests can migrate off `nodes` progressively.
- 2026-02-13: Implemented generic patch operations in `packages/billing/src/components/invoice-designer/state/patchOps.ts` and exposed them on the store:
  - `setNodeProp` / `unsetNodeProp` for dot-path updates (immutable deep updates with empty-object cleanup).
  - `insertChild` / `removeChild` / `moveNode` / `deleteNode` for hierarchy mutations (cycle prevention in `moveNode`).
  - Renamed legacy coordinate nudge API to `moveNodeByDelta` to free `moveNode` for tree moves.
- 2026-02-13: Refined undo/redo history behavior in `packages/billing/src/components/invoice-designer/state/designerStore.ts`:
  - Store now initializes history with a baseline snapshot so the first committed mutation can be undone.
  - `setNodeProp` / `unsetNodeProp` now commit to history by default to match existing property-edit behavior.
- 2026-02-13: Introduced component schema definitions in `packages/billing/src/components/invoice-designer/schema/componentSchema.ts`:
  - Defines per-component label/description/category, defaults (size/layout/metadata), and hierarchy allowlists.
  - `packages/billing/src/components/invoice-designer/constants/componentCatalog.ts` now derives palette definitions from schema (schema is the new source of truth for palette metadata/defaults).
- 2026-02-13: Hierarchy allowlists are now resolved via schema:
  - `packages/billing/src/components/invoice-designer/state/hierarchy.ts` is now a thin wrapper over `getComponentSchema(type).hierarchy`.
- 2026-02-13: Palette insertion now uses schema defaults and generic tree ops:
  - `packages/billing/src/components/invoice-designer/state/designerStore.ts` `addNodeFromPalette` now pulls size/layout/style/metadata defaults from `getComponentSchema(type).defaults` and attaches nodes using `insertChild` semantics (`patchOps.insertChild`).
  - Default metadata normalization for repeated insertions (table columns, attachment items) moved into the store (`normalizeDefaultMetadataForNewNode`), removing hardcoded defaults from `DesignerShell.tsx`.
- 2026-02-13: Outline + breadcrumbs now traverse the tree via children arrays:
  - `packages/billing/src/components/invoice-designer/palette/OutlineView.tsx` now renders from `rootId` and `nodesById`, deriving parent lookup only for expand behavior.
  - `packages/billing/src/components/invoice-designer/DesignerShell.tsx` breadcrumbs now derive parent links from `childIds` instead of relying on persisted `parentId`.
- 2026-02-13: Selection/hover state now validates ids against `nodesById`:
  - `packages/billing/src/components/invoice-designer/state/designerStore.ts` `selectNode`/`setHoverNode` clear invalid ids and `deleteNode` clears selection/hover if the referenced node is removed as part of a subtree delete.
- 2026-02-13: Canvas rendering now resolves from unified node props:
  - Added `packages/billing/src/components/invoice-designer/utils/nodeProps.ts` as the canonical accessor for `props.name`, `props.layout`, `props.style`, `props.metadata` (with temporary legacy fallbacks during cutover).
  - `packages/billing/src/components/invoice-designer/canvas/DesignCanvas.tsx` and `packages/billing/src/components/invoice-designer/canvas/previewScaffolds.ts` now render using `props.*` accessors.
  - Store mutations keep `props` in sync with legacy fields for now (`packages/billing/src/components/invoice-designer/state/designerStore.ts`).
- 2026-02-13: Drag-drop reparent/reorder now uses generic tree ops:
  - `packages/billing/src/components/invoice-designer/DesignerShell.tsx` now calls `store.moveNode(...)` (tree move) instead of `moveNodeToParentAtIndex`.
  - `packages/billing/src/components/invoice-designer/state/designerStore.flowDnd.test.ts` updated to exercise `moveNode(...)` directly.
- 2026-02-13: Resizing now writes through the generic patch API:
  - Removed `updateNodeSize` from `packages/billing/src/components/invoice-designer/state/designerStore.ts`.
  - `packages/billing/src/components/invoice-designer/DesignerShell.tsx` now implements `resizeNode(...)` using `setNodeProp` writes (`size.*`, `baseSize.*`, `style.*`) with a single history commit on mouse-up.
  - `setNodeProp`/`unsetNodeProp` now mirror `name`/`style.*`/`layout.*`/`metadata.*` updates into both legacy fields and `props.*` during cutover.
- 2026-02-13: Started schema-driven Inspector cutover:
  - Added a minimal inspector schema format in `packages/billing/src/components/invoice-designer/schema/inspectorSchema.ts` and attached schemas to component definitions in `packages/billing/src/components/invoice-designer/schema/componentSchema.ts`.
  - Implemented `packages/billing/src/components/invoice-designer/inspector/DesignerSchemaInspector.tsx` which renders panels/fields from the selected node's component schema and writes edits via `setNodeProp`/`unsetNodeProp` (commit-on-blur for text fields).
  - Updated `packages/billing/src/components/invoice-designer/DesignerShell.tsx` to render the schema-driven inspector for supported metadata panels while leaving complex editors (tables/attachments/media) on the legacy path for now.
- 2026-02-13: Expanded schema-driven Inspector field types and conditional panels:
  - `packages/billing/src/components/invoice-designer/schema/inspectorSchema.ts` now supports `number`, `css-length`, `css-color` field kinds plus `visibleWhen` rules (`nodeIsContainer`, `pathEquals`, `parentPathEquals`).
  - `packages/billing/src/components/invoice-designer/schema/componentSchema.ts` now defines a `COMMON_INSPECTOR` (Layout, Sizing, Flex Item) and merges it into all component schemas, so layout/style edits are schema-defined rather than hardcoded in the shell.
  - `packages/billing/src/components/invoice-designer/DesignerShell.tsx` removed the hardcoded Layout/Sizing/Flex Item inspector blocks and relies on `DesignerSchemaInspector` for those panels; legacy metadata editors remain only for complex types (table columns, attachment items, media).
