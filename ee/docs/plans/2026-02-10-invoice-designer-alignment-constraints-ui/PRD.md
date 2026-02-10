# PRD — Invoice Designer Alignment Constraint Controls

- Slug: `invoice-designer-alignment-constraints-ui`
- Date: `2026-02-10`
- Status: Draft

## Summary

Add first-class constraint authoring controls to the Invoice Template Designer UI so template authors can lock key relationships (left edge, top edge, width, height) between elements.

The engine already supports these constraint types in store/solver state, but today users can only toggle aspect ratio in the inspector. This work exposes the existing constraint system through intentional UI workflows so invoice layouts keep clean alignment as content and section sizing evolve.

MVP scope decisions for this plan:

- Pair constraints are **same-parent only**.
- New pair constraints use fixed **`strong`** strength.
- Constraint rows support **jump-to-counterpart** navigation.
- Deleting constrained nodes **auto-prunes** dangling constraints.

## Problem

Current design workflows rely on manual drag/resize and visual estimation. Even with snap/grid, invoice sections can drift over iterations:

- left edges stop lining up,
- paired columns diverge in width,
- header and billing rows lose shared top baselines,
- adjustments in one section force manual rework in others.

The underlying constraint solver supports alignment and sizing relationships, but users cannot create or manage those relationships in the UI. This leaves high-value layout stability inaccessible.

## Goals

- Expose constraint creation UI for:
  - `align-left`
  - `align-top`
  - `match-width`
  - `match-height`
- Provide a clear two-node authoring workflow (reference node + target node).
- Let users view and remove constraints from inspector without editing raw data.
- Surface solver conflicts with actionable, user-readable feedback.
- Preserve existing aspect-ratio lock behavior while unifying it under a broader constraints experience.

## Non-goals

- Implementing a full Figma-like multi-select transformation system.
- Introducing a new grid layout engine or column-span layout mode.
- Adding new solver primitives beyond the existing four pair constraints + aspect ratio.
- Server-side analytics/telemetry enhancements for constraints usage.

## Users and Primary Flows

Primary persona:

- Billing admin or implementer designing invoice templates who needs durable visual alignment.

Primary flows:

1. **Create pair constraint**
   - User selects a node.
   - User sets it as reference/anchor for constraints.
   - User selects another node and applies `align-left`, `align-top`, `match-width`, or `match-height`.
   - Layout updates immediately and relationship persists.

2. **Review constraints on selected node**
   - User selects a node.
   - Inspector lists all constraints involving that node.
   - User can navigate to the related node and understand relation type.

3. **Resolve conflict**
   - User adds a conflicting constraint.
   - UI surfaces solver conflict message.
   - User removes or adjusts conflicting constraints.

4. **Maintain layout through edits**
   - User changes section spacing/sizing/content.
   - Constraint-bound elements keep expected alignment automatically.

## UX / UI Notes

- Add a **Constraints** panel in the right inspector for eligible nodes.
- Add explicit controls:
  - `Set As Reference`
  - `Clear Reference`
  - action buttons for the four pairwise constraints
  - optional strength selector (default `strong`)
- Show current reference node name/id in a compact banner.
- Add “Constraints on this node” list with:
  - relation type,
  - counterpart node name,
  - remove button.
- Keep aspect-ratio lock control visible and grouped with constraints.
- Add subtle canvas highlight for:
  - reference node,
  - selected node,
  - constrained counterpart nodes (on hover/selection context).

## Requirements

### Functional Requirements

- Add inspector UI to author `align-left`, `align-top`, `match-width`, `match-height` constraints between two nodes.
- Add reference-node session state (in designer shell state) for two-node operations.
- Prevent invalid authoring actions:
  - same-node constraints,
  - unsupported node types (`document`, `page`),
  - cross-parent pair constraints (enforce same-parent-only rule),
  - duplicate constraints for the same relation and node pair.
- Reuse `addConstraint` and `removeConstraint` store actions for all newly exposed constraints.
- Show constraints involving the selected node in inspector with remove controls.
- Allow users to jump from a constraint row to its counterpart node on canvas.
- Preserve and display existing aspect-ratio lock behavior in the same constraints area.
- Surface store/solver conflict errors in the constraints UI with contextual guidance.
- Auto-prune dangling constraints whenever a referenced node is deleted.
- Keep constraint relationships intact across undo/redo and workspace export/import flows.
- Ensure constraints are included when presets/workspace states are saved/loaded through existing designer state pathways.
- Support keyboard and pointer-only workflows for core constraint operations.

### Non-functional Requirements

- Constraint authoring interactions should update layout with no perceptible lag in normal designer workloads.
- Constraints UI must be deterministic and avoid flicker when node selection changes rapidly.
- Error messaging must be recoverable and should not leave editor in unusable state.

## Data / API / Integrations

- No new backend API is required for MVP.
- Use existing client-side state model:
  - `DesignerConstraint` in `designerStore.ts`
  - Cassowary solving in `constraintSolver.ts`
- Ensure generated workspace snapshots continue to serialize `constraints` for downstream compile/preview flows where applicable.
- No AssemblyScript codegen changes are required for constraint authoring itself in this phase.

## Security / Permissions

- No new permission boundary; behavior remains within existing invoice template editor access.
- No cross-tenant data concerns introduced (purely client-side layout state).

## Observability

- Keep existing user-visible constraint error surfacing (`constraintError`) and improve clarity in inspector.
- No additional telemetry scope in this plan.

## Rollout / Migration

- Ship within existing designer feature-flag context.
- No schema migration required.
- Existing templates without constraints continue to work unchanged.

## Open Questions

1. When a jump-to counterpart targets an off-screen node, should MVP also auto-pan the canvas or only change selection?

## Acceptance Criteria (Definition of Done)

- [ ] Users can create `align-left`, `align-top`, `match-width`, and `match-height` constraints from inspector UI.
- [ ] Pair constraints are limited to nodes that share the same immediate parent.
- [ ] Users can remove any existing constraint involving the selected node.
- [ ] Users can jump from a constraint row to its counterpart node.
- [ ] Invalid and duplicate constraint creation attempts are blocked with clear feedback.
- [ ] Constraint conflicts are surfaced with actionable guidance.
- [ ] Deleting a constrained node auto-prunes dangling constraints.
- [ ] Constraint changes participate correctly in undo/redo.
- [ ] Existing aspect ratio lock remains functional and visually integrated into the constraints section.
- [ ] Workspace export/import preserves constraints and rehydrates layout consistently.
- [ ] Automated tests cover store behavior, inspector behavior, and integration-level conflict handling.
