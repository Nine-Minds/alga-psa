# PRD — Grouped Automatic Invoices Selection

- Slug: `grouped-automatic-invoices-selection`
- Date: `2026-03-20`
- Status: Draft

## Summary

Redesign the automatic invoices screen so recurring due work is presented as grouped `client + invoice window` parents with expandable child candidates, while preserving exact execution semantics:

- a parent selection creates one combined invoice only when the selected children are financially compatible
- a non-combinable parent remains grouped visually but requires child-level selection
- `Select All` uses the parent row when combination is allowed and falls back to individual child selection when it is not

This is intentionally more than a UI-only plan. The current recurring invoice stack is single-selector and single-assignment by design, so supporting grouped parent selection with true combined execution requires backend preview/generation changes and a safe representation for multi-assignment invoices.

## Problem

The current automatic invoices screen is technically correct but hard to reason about:

- users see one flat row per recurring candidate rather than “what is due for this client in this period”
- grouped candidates already exist in the data model, but the UI still behaves like a flat table
- preview is only available for single-member candidates
- generate expands selected candidates to child members without a clear parent/child mental model
- `Select All` has no notion of “combine when safe, split when required”

Now that the system supports multiple active contracts per client, this UI becomes even harder to understand. A single client can have multiple child candidates in the same invoice window, and the system needs to express both:

1. visual grouping for understandability
2. invoice-scope compatibility for execution

At the same time, the current backend still assumes:

- one preview/generate request equals one selector input
- one invoice belongs to one `client_contract_id`
- PO enforcement and consumption are header-assignment scoped

So the product problem is twofold:

1. the current UI does not match how users think about due recurring work
2. the current backend is too narrow to support combined grouped execution even when the user experience calls for it

## Goals

- Present recurring due work as grouped `client + invoice window` parents.
- Keep child candidates visible and selectable so users can split work intentionally.
- Enable parent-level combined selection only when all selected children share a compatible invoice-level financial scope.
- Make `Select All` smart:
  - select a parent when it can become one invoice
  - select children individually when the group cannot combine
- Preview and generation must always reflect the exact current selection.
- Support a true combined invoice outcome for compatible multi-child selections.
- Preserve explainability: the UI must clearly say whether the current selection will generate one invoice or several.

## Non-goals

- Reworking service-period generation or recurring due-work eligibility rules.
- Removing PO, currency, tax, or export-shape constraints.
- Silently auto-combining incompatible children behind the user’s back.
- Solving generalized shared-PO-budget semantics beyond what is required to determine combination compatibility safely.
- Redesigning unrelated billing tabs or the whole billing dashboard navigation.
- Adding observability/telemetry/feature flags as first-class scope in this plan.

## Users and Primary Flows

- Billing admin
  1. Opens automatic invoices.
  2. Sees one grouped row for a client and invoice window.
  3. Expands it to inspect child candidates when needed.
  4. Selects the parent when the system says the children can combine into one invoice.
  5. Selects children individually when the group is not combinable.
  6. Uses `Select All` across many groups without having to understand every internal split rule first.

- Finance/admin
  1. Previews a grouped selection.
  2. Sees explicitly whether the current selection will generate one invoice or several.
  3. Generates invoices with confidence that PO and financial boundaries are respected.

- Support/engineering
  1. Reads the grouped selection output and can tell why a parent is or is not combinable.
  2. Can trace a combined invoice back to its child assignment/contract candidates safely.

## Product Decisions

### 1. Grouping is visual-first, execution-explicit

The automatic invoices screen groups by `client + invoice window` because that matches the user’s mental model.

This parent grouping does **not** by itself mean “one invoice.” Execution still depends on compatibility.

### 2. Parent selection means “one invoice” only when combinable

If a parent checkbox is enabled and selected, the meaning is explicit:

- generate one combined invoice for the eligible children in that group

If the parent is not combinable, its checkbox is disabled rather than overloaded with a different execution meaning.

### 3. Child selection always means “this child execution unit”

Child rows remain the atomic execution units. Users can always invoice at child scope, even when the parent cannot combine.

### 4. `Select All` is smart and non-surprising

`Select All` behaves as follows:

- for combinable groups, it selects the parent row
- for non-combinable groups, it selects child rows individually

This allows bulk invoicing without forcing users to manually reason through every grouping rule.

### 5. Compatibility is defined by invoice-level financial scope

A parent group is combinable only when all selected children share the same effective:

- client
- currency
- purchase-order scope
- tax source
- export/accounting shape

If any differ, the parent remains grouped visually but is not combinable.

### 6. Multi-assignment combined invoices become explicit supported behavior

For compatible grouped selections that span multiple `client_contract_id` values, the system must support one invoice whose assignment attribution is preserved at charge level rather than pretending the whole invoice belongs to only one assignment.

### 7. Header-level assignment ownership becomes optional

The invoice header may still carry `client_contract_id` for single-assignment invoices, but a multi-assignment combined invoice must not require a fake “primary” assignment owner.

Charge-level assignment attribution becomes authoritative for combined invoices.

## UX / UI Notes

- Replace the flat “ready to invoice” row model with grouped expandable parents.
- Parent rows must display:
  - client name
  - invoice window
  - child count
  - total amount
  - combinability summary
  - invoice-count summary for the current selection state
- Child rows must display:
  - contract or assignment identity
  - cadence source
  - billing timing
  - service period
  - amount
  - PO/financial badges where relevant
- Parent rows use tri-state selection when some but not all eligible children are selected.
- When the parent is non-combinable, the checkbox is disabled and the reason is shown clearly.
- Preview must explicitly tell the user whether the current selection will generate:
  - `1 invoice`
  - or `N invoices`
- Incompatibility messaging should name the reason:
  - `PO scope differs`
  - `Currency differs`
  - `Tax treatment differs`
  - `Export shape differs`
- The screen should never require users to infer from “greyed out” alone why a parent cannot combine.

## Requirements

### Functional Requirements

1. Automatic invoices must group ready rows by `client + invoice window`.
2. Each group must render a parent row with expandable child rows.
3. The parent row must include child count, aggregate amount, and combinability status.
4. Child rows must remain individually selectable.
5. Parent selection must be enabled only when the currently eligible children are combinable.
6. Parent selection must mean “generate one combined invoice.”
7. Parent rows must expose tri-state selection when some but not all eligible children are selected.
8. `Select All` must select:
   - parent rows for combinable groups
   - child rows for non-combinable groups
9. Mixed ready/blocked groups must remain visible; blocked children cannot be selected.
10. Compatibility must be computed from effective invoice-level financial scope:
    - client
    - currency
    - purchase-order scope
    - tax source
    - export shape
11. Preview must support parent selections and child selections.
12. Preview must show one combined invoice preview when the current selection is combinable as one invoice.
13. Preview must show multi-invoice output or a multi-invoice summary when the current selection fans out into several invoices.
14. Generation must execute exactly the selected scope and must not re-expand into unselected siblings.
15. Combined parent generation must create one invoice when the selection is combinable.
16. Non-combinable child selections must generate multiple invoices without changing child attribution.
17. Duplicate prevention and idempotency must work for grouped parent selections and child selections.
18. Multi-assignment combined invoices must be persistable without inventing a fake single `client_contract_id` owner on the invoice header.
19. Charge-level assignment attribution must remain available for combined invoices.
20. Invoice reads, history, and related billing queries must expose enough assignment provenance to explain grouped/combined invoices.
21. Purchase-order enforcement must continue to prevent invalid combined invoices.
22. Parent combination must remain disabled for groups whose selected children do not share compatible PO scope.
23. Existing single-assignment invoice behavior must remain unchanged for legacy single-child and single-assignment flows.
24. Help text/docs/runbooks must describe the grouped parent/child model and `Select All` semantics.

### Non-functional Requirements

- No silent combination of incompatible children.
- No hidden fallback to “pick the first assignment” in preview, generation, history, or PO handling.
- The grouped UI must remain understandable with large ready-work lists.
- DB-backed integration coverage must include both compatible combined groups and incompatible split groups.
- Source-string or wiring tests are insufficient on their own for the new invoice-scope behavior.

## Data / API / Integrations

- Current due-work candidates already contain `members`, but preview/generate APIs accept only a single `IRecurringDueSelectionInput`.
- This plan requires a grouped selection payload for parent-level execution and preview.
- Current invoice generation enforces one `client_contract_id` per invoice. That must be relaxed for combined multi-assignment invoices.
- For combined invoices:
  - invoice header `client_contract_id` must become optional or otherwise stop pretending to be authoritative
  - charge-level `client_contract_id` becomes the authoritative assignment attribution
- Duplicate prevention must move from single-selector identity to grouped selection identity or per-member identity aggregation.
- Purchase-order enforcement must continue to operate against effective PO scope and must block combined execution when the scope differs.
- Invoice history and query surfaces that currently rely on `invoices.client_contract_id` alone must be updated to support combined invoices safely.

## Security / Permissions

- Existing invoice preview/generate permissions remain unchanged.
- The grouped UI must not expose extra data across tenants or across unauthorized billing scopes.
- Group expansion must only reveal child candidates the current user could already see individually.

## Observability

No dedicated observability work is in scope for this plan.

If implementation touches existing billing logs, it should keep them accurate, but adding new telemetry is not part of this plan by default.

## Rollout / Migration

1. Add grouped parent/child selection semantics to the automatic invoices UI.
2. Introduce grouped selection preview/generation APIs and payloads.
3. Update duplicate prevention and execution identity handling for grouped selections.
4. Update invoice persistence so compatible multi-assignment combined invoices are representable without fake header assignment ownership.
5. Update invoice reads/history/PO queries that currently assume `invoices.client_contract_id` is always the invoice owner.
6. Add regression coverage for grouped selection, combined execution, and smart `Select All`.
7. Update billing docs and runbooks.

If schema changes are required to represent combined invoices safely, they are in scope for this plan.

## Open Questions

- Should multi-invoice preview render as several full preview cards, or one summary card plus drill-down?
- For combined multi-assignment invoices with no shared assignment owner, should the UI show an explicit “multi-contract invoice” badge in history and invoice detail?
- If a group contains blocked children and ready children, should the parent summary count only ready children in its main total or show both totals explicitly?

## Acceptance Criteria (Definition of Done)

- The automatic invoices screen presents grouped parent rows by `client + invoice window`.
- Users can expand a parent to inspect child candidates.
- A combinable parent can be selected and previewed/generated as one invoice.
- A non-combinable parent clearly explains why it cannot combine and still allows child-level selection.
- `Select All` selects parents when possible and child rows when necessary.
- Preview and generation always state the exact invoice count implied by the current selection.
- A compatible grouped selection spanning multiple child candidates can generate one invoice without losing assignment attribution.
- Incompatible grouped selections still generate correctly as multiple invoices.
- Existing single-child and single-assignment flows still behave correctly.
- Docs and tests describe the grouped model clearly enough that the behavior cannot silently regress.
