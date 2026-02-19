# PRD — Invoice Designer Unified Component AST (Generic Nodes + Schema-Driven Inspector)

- Slug: `invoice-designer-unified-component-ast`
- Date: `2026-02-13`
- Status: Planned
- Depends on:
  - `ee/docs/plans/2026-02-13-invoice-designer-native-css-layout-engine/`
  - `ee/docs/plans/2026-02-12-invoice-template-json-ast-renderer-cutover/`

## Summary

Refactor the invoice designer's internal canvas state from a typed, field-heavy `DesignerNode` model plus per-property actions into a single unified, immutable JSON tree:

- `Record<NodeId, { type: string, props: Record<string, unknown>, children: NodeId[] }>`

All mutations must go through a small, generic patch/mutation API (for example: `setNodeProp(id, 'style.width', '320px')`). This patch API is the primary enabler of the simplification: without it, the refactor becomes a re-shape with no velocity gain.

The Inspector (Property Editor) becomes schema-driven: it renders its controls by reading a component schema rather than being hardcoded per property or per component type.

## Problem

The designer's state model and editor UI are effectively coupled to specific property groups:

- Adding a new CSS-like property (for example `borderRadius`) requires new store wiring, bespoke reducer logic, dedicated inspector UI, and tests.
- Hierarchy and per-property concerns leak across multiple modules, creating sync logic, duplication, and drift.

This increases maintenance cost and slows iteration on layout and styling capabilities.

## Insight

Every visual element on the canvas is the same abstraction:

- a node with a `type`
- a `props` dictionary
- a list of `children`

Once the designer state is a generic tree, editing becomes a generic patch problem and the property editor becomes a schema rendering problem.

## Goals

- Represent the full designer workspace as a unified JSON tree with one source of truth.
- Replace per-property store actions (`updateNodeStyle`, `updateNodeLayout`, `updateNodeMetadata`, etc.) with a single generic patch/mutation API.
- Make the Inspector schema-driven so most new properties require only schema changes, not store changes.
- Move hierarchy rules (allowed parent/child types) out of `state/hierarchy.ts` into component schema definitions.
- Keep undo/redo, selection, drag-drop, and resizing behavior intact.

## Non-goals

- Changing invoice-template AST semantics or invoice renderer behavior.
- Implementing a general-purpose JSON Schema engine; the designer only needs a constrained, safe schema format.
- Building an expression language for arbitrary computation inside the designer.

## Users and Primary Flows

Primary personas:

- Billing admins composing invoice layout in the designer.
- Engineers adding new components and styling/layout properties.

Primary flows:

1. Add a component from the palette
2. Select a node and edit properties in the Inspector
3. Drag/drop to reorder and reparent nodes
4. Resize nodes (where supported) and see sizing properties updated
5. Save and preview templates

## UX / UI Notes

- Inspector panels should be generated from schema and grouped logically (Layout, Spacing, Sizing, Typography, Data Binding, Table Columns, etc.).
- Component-specific metadata editing (for example table columns) remains supported, but is driven by schema-based UI widgets (array editor, enum pickers, etc.).
- The palette and outline should be driven by the same component schema source of truth (labels, descriptions, defaults, hierarchy rules).

## Data Model

### Canonical Workspace Tree

Store source of truth:

- `rootId: NodeId`
- `nodesById: Record<NodeId, DesignerAstNode>`

Where:

- `DesignerAstNode = { id: NodeId, type: DesignerComponentType, props: Record<string, unknown>, children: NodeId[] }`

Notes:

- `children` is the only authoritative structure for the hierarchy.
- `parentId` is not persisted to avoid redundant data and sync bugs; parent is derived when needed.

### Props Conventions

Standardized props keys (conventions, not hard typing):

- `props.name: string` (designer display name)
- `props.style: Record<string, unknown>` (CSS-like style, same conceptual fields as today)
- `props.layout: Record<string, unknown>` (container layout: flex/grid subset)
- `props.metadata: Record<string, unknown>` (component-specific configuration)

### Mutations (Patch Operations)

Replace bespoke store actions with a small set of generic operations. This is a hard requirement for this strategy to pay off; implementing the unified node shape without the patch API does not meaningfully reduce complexity.

- `setNodeProp(nodeId, path, value)` where `path` is dot-notation like `style.width` or `metadata.bindingKey`
- `unsetNodeProp(nodeId, path)`
- `insertChild(parentId, childId, index)`
- `removeChild(parentId, childId)`
- `moveNode(nodeId, nextParentId, nextIndex)`
- `deleteNode(nodeId)` (removes subtree + fixes parent children list)

Implementation should use immutable updates (structural sharing) and preserve undo/redo behavior.

## Requirements

### Functional Requirements

- Designer store persists and exports the unified tree (not a list of typed nodes).
- Existing operations are supported through the generic patch/mutation API (no per-property store actions remain):
  - adding components from palette (uses schema defaults)
  - updating layout/style properties
  - updating component metadata (tables, totals, fields, etc.)
  - reparenting and reorder operations (drag-drop)
  - resizing nodes updates sizing-related props
- Inspector renders based on a component schema:
  - Field types: string, number, boolean, enum, css-length, css-color, object, array
  - Support custom widgets for complex props:
    - table columns editor
    - dynamic-table column bindings
    - rich text (optional, if already supported)
- Hierarchy allowlists are enforced by schema (allowed parents/children) and are the only authority.

### Non-functional Requirements

- Avoid performance regressions for typical template sizes (tens to low hundreds of nodes).
- Keep state history snapshots bounded (same behavior as today).
- Keep serialized workspace format deterministic and stable.

## Eliminated (Deleting Architectural Layers)

- `packages/billing/src/components/invoice-designer/state/hierarchy.ts`
- Dozens of special-case state slices and per-property actions (size, constraints, label text, etc.)
- Synchronization logic between hierarchy representations and property stores

## Rollout / Migration

- No tenant templates require migration (no custom templates in production yet).
- Workspace persistence format may change; update standard templates and designer storage accordingly.

## Risks

- A naive patch engine can accidentally allow invalid values (needs schema validation and normalizers).
- Some complex metadata editors (tables) require schema widgets beyond primitive fields.
- Refactor touches many call sites and tests; risk of regressions in drag-drop and undo/redo.

## Acceptance Criteria (Definition of Done)

- [ ] Designer state source of truth is `nodesById + rootId` with generic node shape (`type`, `props`, `children`).
- [ ] Store exposes a generic patch/mutation API (`setNodeProp`, `unsetNodeProp`, `moveNode`, etc.) as the only way to modify the tree; per-property update actions are removed.
- [ ] Inspector UI is generated from a schema and covers the existing editable properties.
- [ ] Palette defaults, inspector defaults, and hierarchy rules all come from the same schema source of truth.
- [ ] `state/hierarchy.ts` is deleted and no longer referenced.
- [ ] Undo/redo works correctly with patch operations.
- [ ] Drag-drop reorder and reparent operations update only the unified tree and remain covered by tests.
- [ ] Designer workspace import/export to invoice-template AST still roundtrips deterministically.
