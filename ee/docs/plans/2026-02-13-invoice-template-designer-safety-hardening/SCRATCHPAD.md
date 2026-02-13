# Scratchpad — Invoice Template + Designer Safety Hardening

- Plan slug: `invoice-template-designer-safety-hardening`
- Created: `2026-02-13`

## What This Is

Keep a lightweight, continuously-updated log of discoveries and decisions made while implementing this plan.

Prefer short bullets. Append new entries as you learn things, and also *update earlier notes* when a decision changes or an open question is resolved.

## Decisions

- (2026-02-13) Canonical designer state is `node.props` + `node.children`.
  - Rationale: eliminates dual-source-of-truth bugs and aligns with the unified component AST direction.
- (2026-02-13) Generic patch/mutation API (`setNodeProp`/`unsetNodeProp`) must reject prototype-pollution keys in paths.
  - Rationale: path-based writes are otherwise a common source of prototype pollution.
- (2026-02-13) Leaf array `unset` splices the array (removes the element) instead of writing `undefined`.
  - Rationale: avoids sparse arrays and avoids JSON serialization converting `undefined` to `null` in history snapshots.
- (2026-02-13) Invoice template AST style identifiers are validated (reject invalid) rather than sanitized at render time.
  - Rationale: sanitization can create collisions; validation fails fast and keeps rendering deterministic.

## Discoveries / Constraints

- (2026-02-13) Recent tracked secrets: `server/.env.local.bak.*` were committed and then removed in `fc2625507`.
- (2026-02-13) Current patch implementation writes to both `props.*` and legacy top-level fields via `expandPaths`:
  - `packages/billing/src/components/invoice-designer/state/designerStore.ts`
- (2026-02-13) Patch ops currently allow arbitrary object keys and could write `__proto__` unless guarded:
  - `packages/billing/src/components/invoice-designer/state/patchOps.ts`
- (2026-02-13) Invoice template AST renderer emits CSS selectors/vars based on unvalidated identifiers:
  - `packages/billing/src/lib/invoice-template-ast/react-renderer.tsx`
  - `packages/billing/src/lib/invoice-template-ast/schema.ts`

## Commands / Runbooks

- (2026-02-13) Check for tracked env backups:
  - `git ls-files | rg "\\.env\\.local\\.bak\\.|\\.env\\.bak\\."`

## Links / References

- PRDs, issues, PRs, docs, dashboards, logs, and key file paths.
- Key files:
  - `packages/billing/src/components/invoice-designer/state/patchOps.ts`
  - `packages/billing/src/components/invoice-designer/state/designerStore.ts`
  - `packages/billing/src/components/invoice-designer/utils/nodeProps.ts`
  - `packages/billing/src/lib/invoice-template-ast/schema.ts`
  - `packages/billing/src/lib/invoice-template-ast/react-renderer.tsx`

## Open Questions

- Questions that block the work or need follow-up.
- Do we want patch rejection to be silent no-op, console-warn, or surfaced as a formal diagnostic in the designer UI?
