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
- (2026-02-13) Added repo `.gitignore` patterns to ignore env-backup files (e.g. `**/.env*.bak*`, `server/.env.local.bak*`) to prevent credential leaks.
- (2026-02-13) Added repo guardrails to fail CI if any tracked file matches `.env*.bak*` patterns:
  - Script: `scripts/guard-no-tracked-env-backups.mjs`
  - CI: `.github/workflows/secrets-env-backup-guard.yml`
- (2026-02-13) Current patch implementation writes to both `props.*` and legacy top-level fields via `expandPaths`:
  - `packages/billing/src/components/invoice-designer/state/designerStore.ts`
- (2026-02-13) Designer store now normalizes legacy patch paths (`name`, `metadata.*`, `layout.*`, `style.*`) to canonical `props.*` and writes only canonical state.
  - `packages/billing/src/components/invoice-designer/state/designerStore.ts`
- (2026-02-13) Legacy node fields (`name`, `metadata`, `layout`, `style`) are treated as derived views of canonical `props.*` (no independent writes).
  - `packages/billing/src/components/invoice-designer/state/designerStore.ts`
- (2026-02-13) Hierarchy mutations now treat `node.children` as canonical and no longer rely on or update `childIds`.
  - `packages/billing/src/components/invoice-designer/state/patchOps.ts`
  - `packages/billing/src/components/invoice-designer/state/designerStore.ts`
- (2026-02-13) UI call sites now use canonical `props` reads via `getNodeName/getNodeMetadata/getNodeLayout/getNodeStyle` (no direct legacy field reads in UI components touched).
  - `packages/billing/src/components/invoice-designer/DesignerShell.tsx`
  - `packages/billing/src/components/invoice-designer/palette/OutlineView.tsx`
  - `packages/billing/src/components/invoice-designer/labelText.ts`
  - Removed stale `layout.mode`/`layout.sizing` references from section-fit messaging; CSS-first layout now keys off `layout.display`.
- (2026-02-13) Continuous typing interactions in the metadata inspector now use `commit=false` on `onChange` and `commit=true` on `onBlur` to avoid history spam.
  - `packages/billing/src/components/invoice-designer/DesignerShell.tsx`
- (2026-02-13) Patch ops currently allow arbitrary object keys and could write `__proto__` unless guarded:
  - `packages/billing/src/components/invoice-designer/state/patchOps.ts`
- (2026-02-13) Patch ops now reject prototype-pollution path segments (`__proto__`, `prototype`, `constructor`) at any depth (safe no-op):
  - `packages/billing/src/components/invoice-designer/state/patchOps.ts`
  - Rejection behavior: returns the original `nodes` reference and performs no mutation or history side-effects.
  - Observability: rejected patches emit a dev-only `console.warn`.
- (2026-02-13) Patch ops `unset` for leaf array indices now splices the array (removes element, no `undefined` holes).
  - `packages/billing/src/components/invoice-designer/state/patchOps.ts`
  - Nested unsets inside array elements keep the element in place; if the element becomes empty it is left as `{}` to remain JSON-serializable.
- (2026-02-13) Patch ops now reject non-JSON values in `setNodeProp` (e.g. `undefined`, `NaN`, `Infinity`, functions, class instances) to keep history snapshots deterministic.
  - `packages/billing/src/components/invoice-designer/state/patchOps.ts`
  - Array `set` fills missing indices with `null` to avoid sparse arrays (JSON stringification would otherwise introduce `null` implicitly).
- (2026-02-13) Invoice template AST renderer emits CSS selectors/vars based on unvalidated identifiers:
  - `packages/billing/src/lib/invoice-template-ast/react-renderer.tsx`
  - `packages/billing/src/lib/invoice-template-ast/schema.ts`
- (2026-02-13) Invoice template AST schema now validates style identifiers (class keys, token ids, styleRef tokenIds) against a strict safe identifier regex and rejects invalid inputs.
  - `packages/billing/src/lib/invoice-template-ast/schema.ts`
- (2026-02-13) Invoice template AST renderer now sanitizes style identifiers before emitting CSS selectors and custom properties (defense-in-depth even if schema validation is bypassed).
  - `packages/billing/src/lib/invoice-template-ast/react-renderer.tsx`
- (2026-02-13) Legacy workspace `nodes[]` imports can include `props: {}`; snapshotting now materializes canonical `props.name/metadata/layout/style` from legacy top-level fields so UI helpers can consistently read canonical props.
  - `packages/billing/src/components/invoice-designer/state/designerStore.ts`
  - Test: `packages/billing/src/components/invoice-designer/state/designerStore.loadWorkspace.legacy.test.ts`
- (2026-02-13) Added hierarchy unit coverage to ensure canonical `children` is authoritative and `childIds` is not used/written during mutations.
  - Test: `packages/billing/src/components/invoice-designer/state/patchOps.insertChild.test.ts`
- (2026-02-13) Extended hierarchy unit coverage for `moveNode` to assert ordering adjustments, cycle prevention, and canonical `children` authority (no legacy `childIds` writes).
  - Test: `packages/billing/src/components/invoice-designer/state/patchOps.moveNode.test.ts`
- (2026-02-13) Extended hierarchy unit coverage for `deleteNode` to ensure subtree traversal keys off canonical `children` and does not mutate legacy `childIds`.
  - Test: `packages/billing/src/components/invoice-designer/state/patchOps.deleteNode.test.ts`

## Commands / Runbooks

- (2026-02-13) Check for tracked env backups:
  - `git ls-files | rg "\\.env\\.local\\.bak\\.|\\.env\\.bak\\."`
- (2026-02-13) Check `.gitignore` contains env-backup ignore patterns:
  - `node scripts/test-gitignore-env-backups.mjs`
- (2026-02-13) Test env-backup guard script (pass + fail cases in a temp git repo):
  - `node scripts/test-guard-no-tracked-env-backups.mjs`
- (2026-02-13) Run invoice-designer unit tests (Vitest config root is `server/`):
  - `cd server && npx vitest run ../packages/billing/src/components/invoice-designer/state/patchOps.setNodeProp.test.ts`
- (2026-02-13) Gotcha: Vitest can fail with `ENOSPC` (no space left on device); running with `--coverage=false` reduces temp output and avoided the issue locally.

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
