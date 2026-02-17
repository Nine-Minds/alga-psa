# PRD — Invoice Template + Designer Safety Hardening

- Slug: `invoice-template-designer-safety-hardening`
- Date: `2026-02-13`
- Status: Draft

## Summary
Tighten safety and correctness around the new JSON-AST invoice renderer and the invoice designer’s unified “generic node + props + children” state by:

- Preventing accidental credential leaks in the repo.
- Hardening the generic patch/mutation API against prototype pollution and ambiguous semantics.
- Eliminating dual-source-of-truth behavior (stop writing the same value to multiple places).
- Making undo/redo semantics deterministic for JSON-serializable state.
- Validating CSS identifier inputs in the invoice template AST (styles/tokens/classes).

## Problem
After the invoice-template JSON AST cutover and the unified designer patch API work, the codebase has a few sharp edges:

- Secrets/credentials can be accidentally committed (recent `.env` backups were tracked).
- The generic patch API (`setNodeProp`/`unsetNodeProp`) can write attacker-controlled keys like `__proto__`, creating prototype pollution risk.
- Designer state is currently duplicated during cutover (`props.*` plus legacy top-level fields; `children` plus `childIds`), increasing divergence risk.
- Undo/redo stores full snapshots and clones `props` via JSON serialization, which is expensive and can change values if state contains non-JSON primitives or `undefined` in arrays.
- Invoice template AST style tokens/classes are emitted into CSS without identifier validation.

## Goals
- Ensure `.env` backups and similar credential files cannot be accidentally tracked again.
- Make the designer’s generic patch/mutation API explicitly safe:
  - Reject prototype-pollution keys in patch paths.
  - Define deterministic semantics for array `unset`.
- Make `node.props` and `node.children` the single canonical sources of truth for designer node data/hierarchy.
- Keep undo/redo behavior correct and deterministic for JSON-serializable designer state.
- Ensure invoice template AST style identifiers are safe and validated before rendering.

## Non-goals
- No user-facing redesign of the invoice designer UI.
- No migration tooling for existing customer templates (there are none).
- No new invoice template “scripting” capabilities beyond the existing allowlisted strategy mechanism.
- No broad performance rewrite of the designer/store beyond what is required to remove correctness/safety hazards.

## Users and Primary Flows
- Template authors (internal, for now) edit invoice layouts in the designer and preview them against sample/existing invoice data.
- Developers iterate locally without accidentally committing secrets.

## UX / UI Notes
- No expected visual changes.
- Any newly-added validation errors should surface as existing diagnostics/toasts (no new UI framework work).

## Requirements

### Functional Requirements
1. Repo secrets hygiene:
   1. Add gitignore patterns for local env backups so they don’t get staged.
   2. Add a lightweight guard (test or CI check) that fails if known env-backup patterns are tracked.
2. Generic patch/mutation API hardening (explicit requirement):
   1. `setNodeProp(nodeId, path, value, commit?)` and `unsetNodeProp(nodeId, path, commit?)` must reject unsafe path segments (`__proto__`, `prototype`, `constructor`) and perform no mutation on rejection.
   2. Patch operations must be deterministic and must not introduce non-JSON values into canonical designer state.
   3. Patch operations must preserve immutability (return structurally-shared copies, no in-place mutation of existing nodes/state).
3. Canonical designer node representation:
   1. Canonical fields: `node.props` and `node.children`.
   2. Legacy fields (`name`, `metadata`, `layout`, `style`, `childIds`) must not be separately mutated during the cutover. If they exist for back-compat, they must be derived from canonical fields or only used when importing legacy data.
4. Undo/redo semantics:
   1. Undo/redo must restore the exact canonical JSON state that was committed.
   2. Array unset behavior must be defined and tested (see Non-functional requirements).
5. Invoice template AST CSS identifier safety:
   1. `styles.classes` keys, `styles.tokens.*.id`, and `node.style.tokenIds` must be validated against a safe identifier rule.
   2. Invalid identifiers must cause schema validation failure (and should surface as diagnostics rather than producing malformed CSS).

### Non-functional Requirements
1. Canonical designer node state must remain JSON-serializable.
2. Array unsetting semantics decision:
   1. `unset` for an array index at the leaf path must not produce `undefined` holes.
   2. Preferred implementation: leaf-array `unset` performs a `splice` (removes the element, shifting indices).
3. Patch path parsing must have a small, well-defined grammar (dot-separated segments; integer segments for arrays).
4. Any performance impact must be bounded:
   1. Continuous interactions (drag/resize/typing) must use `commit=false` for interim updates and `commit=true` only on completion.
   2. History snapshot creation must not occur on every pointer-move.

## Data / API / Integrations
- No external API changes.
- Internal shape: designer state uses a unified JSON tree (node map + children).
- Invoice template AST schema validation is the gate before evaluation/rendering.

## Security / Permissions
- Prevent leaking `.env`-like credentials via git tracking.
- Prevent prototype pollution via patch path segments in generic mutation APIs.
- Ensure invoice template AST style identifiers cannot inject arbitrary CSS selectors/variables.

## Observability
- Rejected patch operations should be observable in development:
  - console warning (developer-facing), and/or
  - surfaced as diagnostics in existing debug panels if available.

## Rollout / Migration
- No customer migration required.
- For local dev: `.gitignore` prevents recurrence; guard ensures CI catches accidental tracking.

## Open Questions
- None required to start. Any discovered call sites depending on legacy top-level fields should be migrated to canonical `props` reads.

## Acceptance Criteria (Definition of Done)
1. No `.env.local.bak*` (or similar) files are tracked by git, and guardrails exist to prevent recurrence.
2. `setNodeProp`/`unsetNodeProp` reject `__proto__`/`prototype`/`constructor` path segments and cannot pollute prototypes.
3. Designer node data has a single source of truth:
   1. `props` is canonical for name/layout/style/metadata.
   2. `children` is canonical for hierarchy; no `childIds` reliance remains.
4. Undo/redo restores canonical JSON state without `undefined` hole issues, and continuous interactions do not spam history entries.
5. Invoice template AST validation rejects unsafe style identifiers; renderer does not emit malformed CSS selectors/variables for style identifiers.
