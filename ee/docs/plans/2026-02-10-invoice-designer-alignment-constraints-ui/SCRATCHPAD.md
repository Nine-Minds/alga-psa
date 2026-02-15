# Scratchpad — Invoice Designer Alignment Constraint Controls

- Plan slug: `invoice-designer-alignment-constraints-ui`
- Created: `2026-02-10`
- Scope status: `draft`

## What This Is

Working notes for adding UI authoring/management controls for existing pairwise layout constraints in the invoice designer.

## Decisions

- (2026-02-10) Scope focuses on exposing existing constraint primitives in UI (`align-left`, `align-top`, `match-width`, `match-height`) rather than adding new solver math.
- (2026-02-10) MVP will center on core authoring and editing workflows in inspector; full multi-select transform UX is out of scope.
- (2026-02-10) Constraint state remains client-side in designer store and reuses existing `addConstraint` / `removeConstraint` APIs.
- (2026-02-10) Keep production-readiness additions (metrics/telemetry/rollout hardening) out of this plan unless explicitly requested.
- (2026-02-10) Pair constraints are same-parent only for MVP.
- (2026-02-10) Pair-constraint strength is fixed to `strong` in MVP.
- (2026-02-10) Constraint rows support jump-to-counterpart navigation in MVP.
- (2026-02-10) Dangling constraints are auto-pruned when referenced nodes are deleted/hydrated.
- (2026-02-10) Canonical pair-constraint IDs are now normalized by relation + sorted node IDs (`pair-${type}-${minId}-${maxId}`) to block duplicate forward/reverse pairs.
- (2026-02-10) Undo/redo history now snapshots both `nodes` and `constraints` so pair add/remove is fully reversible.
- (2026-02-10) Kept jump-to-counterpart behavior as selection-only for MVP (no auto-pan), matching the PRD open question default.
- (2026-02-10) Solver edit-variable strengths were lowered (`x/y` medium, `w/h` weak) so authored `strong` constraints can actually override positional/size suggestions.

## Discoveries / Constraints

- (2026-02-10) `DesignerConstraint` already supports:
  - pair constraints: `align-left`, `align-top`, `match-width`, `match-height`
  - aspect constraint: `aspect-ratio`
  in `packages/billing/src/components/invoice-designer/state/designerStore.ts`.
- (2026-02-10) Solver implementation already applies pair constraints via Cassowary in `packages/billing/src/components/invoice-designer/utils/constraintSolver.ts`.
- (2026-02-10) Inspector currently exposes only aspect ratio lock, not pair-constraint authoring.
- (2026-02-10) Single-node selection model (`selectedNodeId`) implies pair authoring needs a temporary “reference node” UI state or a wider selection-model change.
- (2026-02-10) Presets can inject constraints during insertion (`insertPreset` maps preset constraints), so constraints already participate in runtime layout solving.
- (2026-02-10) `DesignerShell` now includes a first-class Constraints inspector section with reference-state actions, pair action buttons, list/jump/remove rows, and integrated aspect toggle.
- (2026-02-10) `DesignCanvas` now accepts `activeReferenceNodeId` and `constrainedCounterpartNodeIds` to render distinct visual cues for reference and counterpart nodes.
- (2026-02-10) Store-side constraint sanitization now runs on load/delete/insert/remove paths to auto-prune dangling constraints and dedupe normalized pair constraints.
- (2026-02-10) Conflict/error messaging is surfaced in inspector with recovery guidance and stable automation IDs for QA coverage.
- (2026-02-10) Added focused constraints tests:
  - `DesignerShell.constraints.test.tsx` (authoring workflow, keyboard interactions, list/jump/remove, fit-with-constraints, persistence flows)
  - `designerStore.constraints.test.ts` (normalization, dedupe, validation, undo/redo, export/import, coexistence, pruning)
  - `DesignCanvas.constraintHighlights.test.tsx` (reference/counterpart visual cues).
- (2026-02-10) Full invoice-designer suite is green after refactor (`23 files / 171 tests`).

## Commands / Runbooks

- Scaffold plan folder:
  - `python3 /Users/roberisaacs/.codex/skills/alga-plan/scripts/scaffold_plan.py "Invoice Designer Alignment Constraint Controls" --slug invoice-designer-alignment-constraints-ui`
- Validate plan files:
  - `python3 /Users/roberisaacs/.codex/skills/alga-plan/scripts/validate_plan.py ee/docs/plans/2026-02-10-invoice-designer-alignment-constraints-ui`
- Validate JSON syntax:
  - `jq empty ee/docs/plans/2026-02-10-invoice-designer-alignment-constraints-ui/features.json`
  - `jq empty ee/docs/plans/2026-02-10-invoice-designer-alignment-constraints-ui/tests.json`
- Validate invoice-designer test suite after constraints refactor:
  - `npx vitest run packages/billing/src/components/invoice-designer`
- Targeted constraints test runs:
  - `npx vitest run packages/billing/src/components/invoice-designer/DesignerShell.constraints.test.tsx packages/billing/src/components/invoice-designer/state/designerStore.constraints.test.ts packages/billing/src/components/invoice-designer/canvas/DesignCanvas.constraintHighlights.test.tsx`
- Full regression run:
  - `npx vitest run packages/billing/src/components/invoice-designer`

## Links / References

- `ee/docs/plans/2026-02-10-invoice-designer-alignment-constraints-ui/PRD.md`
- `packages/billing/src/components/invoice-designer/DesignerShell.tsx`
- `packages/billing/src/components/invoice-designer/state/designerStore.ts`
- `packages/billing/src/components/invoice-designer/utils/constraintSolver.ts`
- `packages/billing/src/components/invoice-designer/utils/constraints.ts`
- `packages/billing/src/components/invoice-designer/canvas/DesignCanvas.tsx`
- `packages/billing/src/components/invoice-designer/toolbar/DesignerToolbar.tsx`
- `packages/billing/src/components/invoice-designer/DesignerShell.constraints.test.tsx`
- `packages/billing/src/components/invoice-designer/state/designerStore.constraints.test.ts`
- `packages/billing/src/components/invoice-designer/canvas/DesignCanvas.constraintHighlights.test.tsx`

## Open Questions

- Should jump-to-counterpart also auto-pan canvas in MVP, or only change selection?
