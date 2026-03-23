# PRD — Multi-Active Contracts Per Client

- Slug: `multi-active-contracts-per-client`
- Date: `2026-03-20`
- Status: Draft

## Summary

Remove the application-level “one active contract per client” rule so a client can hold multiple concurrent active contract assignments, while preserving the current invoice boundary that each generated invoice belongs to exactly one `client_contract_id`.

This plan is intentionally comprehensive. It covers the obvious billing-contract wizard blockers, the shared/server-side active-contract guards, the duplicated `packages/clients` assignment rules, assignment-scoped UI identity problems, recurring preview/generation scope, bucket/billing-cycle ambiguity, docs, fixtures, and regression coverage.

The plan does **not** redesign invoice scope to support mixed-contract invoices. Instead, it preserves the current contract-scoped invoice/PO model and makes the rest of the system safe and explicit around that boundary.

## Problem

The current codebase has no database constraint that limits a client to one active contract, but multiple app-layer paths still behave as if that rule were fundamental:

- billing contract creation/edit flows disable clients that already have an active contract
- billing and clients actions/models reject concurrent active assignment windows
- contract header activation/reactivation paths ask “does this client have any other active contract?” rather than reasoning about the target assignment
- some `packages/clients` screens still key identity by `contract_id` instead of `client_contract_id`
- recurring preview/generation for client-cadence candidates can still re-expand work at `client + invoice window` scope instead of the selected contract candidate
- bucket usage and billing-cycle summaries still collapse multiple active assignments to one winner

This produces three classes of failure:

1. Users are blocked from creating a second active contract for the same client even though the schema allows it.
2. If concurrent active assignments are forced in through some paths, UI reads and billing execution can mis-associate data.
3. Historical simplifications around one contract per invoice/PO are only partially documented, so engineers cannot tell which “single contract” assumptions are intended behavior and which are accidental leftovers.

## Goals

- Allow a single client to hold multiple concurrent active `client_contracts` rows.
- Remove blanket UI and action-layer blocking based on “client already has an active contract.”
- Make `client_contract_id` the canonical identity for assignment-scoped UI, reads, and execution.
- Preserve the current invariant that an invoice belongs to exactly one `client_contract_id`.
- Ensure recurring due-work preview/generation runs against the selected assignment/candidate scope, not an entire client window.
- Remove implicit “pick the first active contract” behavior from summary and usage-resolution surfaces.
- Leave docs, tests, and fixtures in a state where the removed rule cannot silently creep back in.

## Non-goals

- Supporting mixed-contract invoices.
- Supporting multiple POs on one invoice.
- Redesigning accounting export payloads for invoices that span multiple contract assignments.
- Changing tax, credit, or export semantics beyond what is required to preserve single-contract invoices safely.
- Reworking every legacy contract/report label in the product; this plan only covers labels whose current wording becomes materially wrong for this behavior.
- Adding new schema constraints or migrations unless implementation discovers a missing index or helper column is required for correctness.

## Target Users / Primary Flows

- Billing admin
  1. Creates a new active contract for a client that already has another active contract.
  2. Configures recurring lines on both contracts.
  3. Sees separate automatic-invoice candidates per contract assignment and can preview/generate them independently.

- Client/account manager
  1. Opens the client billing tab.
  2. Sees multiple active assignments for the same client, including cases where they share the same underlying `contract_id`.
  3. Adds, edits, or removes lines against the intended assignment without ambiguity.

- Finance/admin
  1. Reviews invoice history, PO consumption, and contract detail.
  2. Continues to reason about one invoice belonging to one contract assignment.

- Engineer/support
  1. Reads code, docs, or test fixtures.
  2. Can tell the difference between:
     - multi-active assignments are allowed
     - invoices are still single-assignment scoped
     - ambiguous legacy surfaces must fail explicitly rather than guess

## Product Decisions

### 1. Multi-active assignments are allowed

For this plan, “remove the single-active-contract rule” means a client may have multiple concurrent active assignments, including overlapping date windows.

That means the old overlap validators in shared and `packages/clients` assignment writes are no longer valid as a product rule.

### 2. Invoices remain single-assignment scoped

This plan preserves the existing invoice/PO boundary:

- each invoice resolves to exactly one `client_contract_id`
- PO required/overage/consumption remain invoice-header behavior against one assignment
- accounting exports continue to emit one invoice-level PO/reference

Allowing multi-active contracts therefore requires the system to keep due-work candidates and invoice execution contract-scoped, not to merge them.

### 3. `client_contract_id` is the canonical identity

Any UI, read, or execution path that is assignment-scoped must use `client_contract_id`, not `contract_id`, to identify the target assignment.

Where two active assignments share the same `contract_id`, contract-header identity is not sufficient.

### 4. Ambiguous legacy resolution must stop guessing

Surfaces that currently “pick the latest active contract” or “pick the first matching assignment” must be changed to:

- operate from explicit assignment identity, or
- fail with an explicit ambiguity error

The system must not silently attach usage, lines, or invoices to whichever active assignment sorts first.

### 5. Mixed-currency rule is separate

The existing wizard-level mixed-currency restriction is related but not identical to the single-active-contract rule.

- This plan preserves mixed-currency blocking as a separate policy.
- The policy applies independently of multi-active assignment support: multiple active assignments are allowed, but creating active assignments for the same client in different currencies remains blocked unless a future plan explicitly changes it.
- Removing the single-active-contract singleton must not implicitly remove this mixed-currency guard.

## UX / UI Notes

- Billing contract creation/edit screens must allow selecting a client even if they already have another active contract.
- Any warning copy that still references “terminate their current contract first” must be removed or replaced.
- Assignment management UIs must display enough identity to distinguish multiple active assignments cleanly, especially when they share the same base contract header.
- Contract-line add/edit/remove flows in `packages/clients` must show or carry explicit assignment context.
- Billing-cycle summaries should no longer imply there is only one active contract for a client.

## Requirements

### Functional Requirements

1. Billing contract UI flows must stop disabling or rejecting clients because another active contract exists.
2. Contract header activate/restore/reactivate flows must stop blanket-checking for “any other active contract.”
3. Shared/action/model helpers that encode the singleton active-contract rule must be removed, renamed, or repurposed so they no longer act as write/activation blockers.
4. Assignment create/update flows must allow concurrent active windows.
5. Existing invoiced-period date guards must remain in place; removing the singleton rule must not allow users to move assignment dates across already invoiced periods.
6. `packages/clients` assignment management must use `client_contract_id` as the primary identity in selection, post-create refresh, edit, and display paths.
7. Contract-line reads in `packages/clients` must be assignment-scoped, not derived by joining on `contract_id` alone.
8. Contract-line mutation flows must either operate assignment-scoped or make explicit when they are mutating shared header-level data.
9. Recurring due-work must stay split by contract assignment so multi-active clients do not collapse into one invoice candidate.
10. Recurring preview and generation must execute against the selected candidate/assignment scope, not the whole client invoice window.
11. Fixed recurring charge persistence must not merge charges from different concurrent assignments that share the same template/base line identity.
12. Client-cadence materialization-gap blocking must not block unrelated assignments for the same client/window.
13. BillingCycles must no longer collapse multiple active assignments to a single displayed contract.
14. Bucket usage period resolution must stop picking “the latest active assignment” when multiple overlapping bucket-bearing assignments exist.
15. Report/export surfaces that are already assignment-safe may remain functionally unchanged, but labeling and tests must reflect assignment semantics where current wording becomes misleading.
16. The final plan and docs must explicitly state that:
    - multi-active assignments are allowed
    - invoices remain single-assignment scoped
    - mixed-contract invoice redesign is out of scope

### Non-functional Requirements

- No hidden fallback behavior. If a surface cannot disambiguate an assignment safely, it must fail explicitly.
- The final architecture should reduce duplicated validation logic between `shared`, `packages/billing`, and `packages/clients`.
- DB-backed integration coverage must exercise real concurrent active assignments against migrated schema.
- Test helpers must be capable of creating concurrent assignments intentionally, rather than only through the old single-assignment shape.

## Data / API / Integration Notes

- No schema change is currently required to allow multiple active assignments; existing migrations only enforce uniqueness by assignment identity, not by client active status.
- `invoices.client_contract_id` remains the invoice-level assignment reference and must stay authoritative in this plan.
- `invoice_items.client_contract_id` and recurring candidate grouping already provide the seam for contract-scoped invoice execution; implementation should lean on that instead of broadening invoice scope.
- Shared helper naming should reflect actual semantics:
  - “current active assignment(s)” if date-aware readers remain for reporting/diagnostics
  - never a blanket business invariant if the product no longer wants one

## Risks

- The biggest correctness risk is recurring execution: allowing concurrent active contracts without fixing selected-candidate execution can cause preview/generation to fan back out to the whole client window.
- The biggest UI risk is `packages/clients`, where several screens still behave as if `contract_id` uniquely identifies the active assignment.
- The biggest ambiguity risk is bucket usage: without explicit assignment identity or failure behavior, usage can be attached to the wrong contract.
- The biggest scope-creep risk is invoice redesign. Supporting mixed-contract invoices would cascade into PO consumption, export adapters, invoice queries, and contract views. This plan explicitly avoids that expansion.

## Rollout / Migration

1. Define and document the preserved boundary: multi-active assignments allowed, single-assignment invoices preserved.
2. Remove the singleton UI and action-layer blockers.
3. Refactor assignment identity in `packages/clients`.
4. Fix recurring preview/generation and fixed-charge assignment attribution.
5. Fix secondary ambiguity surfaces such as billing-cycle summaries and bucket usage.
6. Widen fixtures and DB-backed tests so concurrent-assignment cases become first-class regression coverage.
7. Update docs and prior-plan references that encode the removed singleton rule.

No backfill migration is required for historical rows. Existing rows created under the singleton rule remain valid; the behavior change is in runtime guards and scoping.

## Open Questions

- For ambiguous bucket usage when multiple overlapping bucket-bearing assignments match the same client/service/date, should the product require explicit assignment identity upstream or fail at billing time with a user-facing ambiguity error?
- Are there any remaining UI surfaces that should summarize “active assignments” rather than “contracts” once this plan is complete?

## Acceptance Criteria

- A user can create and activate a second active contract for a client who already has another active contract.
- The client billing/configuration UI can display and edit multiple active assignments for the same client without conflating them.
- Automatic invoice candidates remain separated by contract assignment for multi-active clients.
- Previewing or generating one selected recurring candidate does not re-expand into all due work for that client/window.
- Bucket/billing-cycle surfaces no longer silently pick one active assignment when several exist.
- Existing invoice/PO/export behavior remains single-assignment scoped and continues to work for multi-active clients.
- Tests, fixtures, docs, and runbooks no longer encode “one active contract per client” as a live invariant.
