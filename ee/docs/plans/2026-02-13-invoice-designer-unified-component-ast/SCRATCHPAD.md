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
