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

## Developer Guide (Adding Props / Components)

### Component Schema Source Of Truth

- File: `packages/billing/src/components/invoice-designer/schema/componentSchema.ts`
- Each component defines:
  - `label`/`description`/`category` (palette + inspector display metadata)
  - `defaults`: initial `name`, `layout`, `style`, `metadata`, `size`
  - `hierarchy`: `allowedParents` + `allowedChildren`
  - `inspector`: panels/fields (schema-driven Inspector)
- Helpers now live on the schema module:
  - `getAllowedChildrenForType(type)`
  - `getAllowedParentsForType(type)`
  - `canNestWithinParent(childType, parentType)`

### Inspector Schema Format

- Files:
  - `packages/billing/src/components/invoice-designer/schema/inspectorSchema.ts` (field/panel types)
  - `packages/billing/src/components/invoice-designer/inspector/DesignerSchemaInspector.tsx` (renderer)
- Field kinds supported:
  - primitives: `string`, `number`, `boolean`, `enum`
  - CSS-ish: `css-length`, `css-color`
  - complex: `widget` (custom React editor for component-specific metadata)
- Visibility rules:
  - `visibleWhen` supports `nodeIsContainer`, `pathEquals`, `parentPathEquals`
- Widgets:
  - Implement widgets in `packages/billing/src/components/invoice-designer/inspector/widgets/`
  - Register by referencing the widget `id` in schema (example: `table-editor` for `metadata.columns`)

### Patch API (How To Mutate State)

- File: `packages/billing/src/components/invoice-designer/state/designerStore.ts`
- Only supported mutation surface (for anything persistent/undoable):
  - `setNodeProp(nodeId, path, value, commit?)`
  - `unsetNodeProp(nodeId, path, commit?)`
  - `insertChild(parentId, childId, index)`
  - `removeChild(parentId, childId)`
  - `moveNode(nodeId, nextParentId, nextIndex)`
  - `deleteNode(nodeId)`
- Dot-path conventions (recommended):
  - `name`
  - `style.*` (sizing/typography/media CSS-like props)
  - `layout.*` (container layout props)
  - `metadata.*` (component-specific config)
- History/undo semantics:
  - `commit` defaults to `true`
  - For multi-step edits that should be a single undo step: use `commit=false` for intermediate writes and `commit=true` for the final write.

### Persistence Rules (What Gets Serialized)

- Persisted workspace snapshot is `{ rootId, nodesById, canvas settings }`.
- `exportWorkspace()` sanitizes node `props` to drop runtime/editor-only keys:
  - `position`, `size`, `baseSize`, `layoutPresetId`
- If a prop should survive reload and affect output, it should live under:
  - `props.style`, `props.layout`, or `props.metadata` (and be surfaced via schema).

### Conventions For Adding A New Property

1. Add/extend the schema field in `componentSchema.ts` (usually via `COMMON_INSPECTOR` or component-specific `inspector`).
2. Provide a default in `defaults.style` / `defaults.layout` / `defaults.metadata` only if it must exist on insertion.
3. Avoid adding store actions/reducers: use `setNodeProp`/`unsetNodeProp` from inspector and other UI.

### Conventions For Adding A New Component

1. Add a `DesignerComponentSchema` entry in `DESIGNER_COMPONENT_SCHEMAS`.
2. Define `hierarchy.allowedParents` and `hierarchy.allowedChildren` (the only authority for nesting rules).
3. Define `defaults` and `inspector` panels/fields.
4. Canvas/palette/outline should not need bespoke wiring if schema is complete.

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
- 2026-02-13: Added first complex schema widget for metadata:
  - Implemented `packages/billing/src/components/invoice-designer/inspector/widgets/TableEditorWidget.tsx` and wired it into the schema via a `widget` inspector field (`table-editor`).
  - `packages/billing/src/components/invoice-designer/schema/componentSchema.ts` now attaches the table editor widget to both `table` and `dynamic-table` schemas.
  - Removed the hardcoded table/dynamic-table inspector block from `packages/billing/src/components/invoice-designer/DesignerShell.tsx` (tables now render their metadata editor via schema widget).
- 2026-02-13: Updated designer <-> invoice-template AST mapping to prefer unified props + children:
  - `packages/billing/src/components/invoice-designer/ast/workspaceAst.ts` now reads `name/layout/style/metadata` via `packages/billing/src/components/invoice-designer/utils/nodeProps.ts` helpers and traverses `children` (fallback to `childIds` for legacy nodes).
  - Import now materializes `props` and `children` on generated nodes and keeps them in sync with legacy fields during cutover.
  - Updated `packages/billing/src/components/invoice-designer/ast/workspaceAst.test.ts` fixtures to set `props` + `children` so export/import exercises the unified tree.
- 2026-02-13: Added undo/redo history regression test in `packages/billing/src/components/invoice-designer/state/designerStore.undoRedo.test.ts`:
  - Verifies tree state returns exactly to prior snapshots after a `moveNode` followed by `deleteNode`, via sequential `undo()` and `redo()`.
- 2026-02-13: Added schema invariants test in `packages/billing/src/components/invoice-designer/schema/componentSchema.test.ts`:
  - Ensures every component type has defaults, an inspector schema, and reciprocal nesting allowlists (parent allowedChildren aligns with child allowedParents).
- 2026-02-13: Added repo/unit guard ensuring `packages/billing/src/components/invoice-designer/state/hierarchy.ts` stays deleted and is not imported anywhere in the invoice designer code.
- 2026-02-13: Persisted workspace snapshots now omit runtime geometry/editor-only props:
  - `packages/billing/src/components/invoice-designer/state/designerStore.ts` `exportWorkspace()` sanitizes `node.props` to drop `position`, `size`, `baseSize`, and `layoutPresetId` (new saves are unified-only).
  - Updated `packages/billing/src/actions/invoicePreviewPdfParity.integration.test.ts` workspace fixture to use `{ rootId, nodesById }` (no `nodes` / `constraints`).
  - Updated `packages/billing/src/components/invoice-designer/state/designerStore.constraints.test.ts` assertions to validate unified snapshots.
- 2026-02-13: Removed legacy hierarchy module:
  - Deleted `packages/billing/src/components/invoice-designer/state/hierarchy.ts`.
  - Moved `getAllowedChildrenForType` / `getAllowedParentsForType` / `canNestWithinParent` helpers into `packages/billing/src/components/invoice-designer/schema/componentSchema.ts` and updated call sites to import from schema.
- 2026-02-13: Removed per-property store actions in favor of patch ops:
  - Deleted legacy store APIs: `updateNodeName`, `updateNodeMetadata`, `updateNodeLayout`, `updateNodeStyle`, `setNodePosition`, `moveNodeByDelta`, `moveNodeToParentAtIndex`.
  - Kept label text behavior by normalizing label `name` <-> `metadata.text` changes inside `setNodeProp`/`unsetNodeProp` (only when mutating `name` or `metadata.*`).
  - Fixed `rootId` indexing so `exportWorkspace()` snapshots can be round-tripped via `loadWorkspace()` even when legacy fixtures use non-canonical document ids.
  - Updated affected tests and UI call sites to use `setNodeProp`/`unsetNodeProp` exclusively.
- 2026-02-13: Added deterministic unified-tree traversal helper and tests:
  - `packages/billing/src/components/invoice-designer/state/designerAst.ts` now exports `traverseDesignerAstNodeIds`.
  - Added `packages/billing/src/components/invoice-designer/state/designerAst.test.ts`.
- 2026-02-13: Added patch ops unit coverage:
  - Added `packages/billing/src/components/invoice-designer/state/patchOps.setNodeProp.test.ts` to validate immutable deep dot-path updates.
  - Added `packages/billing/src/components/invoice-designer/state/patchOps.unsetNodeProp.test.ts` to validate cleanup behavior for empty objects.
  - Added `packages/billing/src/components/invoice-designer/state/patchOps.insertChild.test.ts` to validate deterministic child insertion ordering.
  - Added `packages/billing/src/components/invoice-designer/state/patchOps.moveNode.test.ts` to validate reorder/reparent semantics + cycle prevention.
  - Added `packages/billing/src/components/invoice-designer/state/patchOps.deleteNode.test.ts` to validate subtree deletion behavior.
