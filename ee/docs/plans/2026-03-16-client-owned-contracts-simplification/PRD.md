# PRD — Client-Owned Contracts Simplification

- Slug: `client-owned-contracts-simplification`
- Date: `2026-03-16`
- Status: Draft

## Summary

Simplify the contracts domain so that reusable definition behavior lives only in contract templates, while every non-template contract becomes a client-owned instantiated contract header. Keep `contracts` as the header/line-owner table, keep `client_contracts` as the assignment/lifecycle window table, and remove the remaining shared-contract mental model from migration, backend rules, status handling, and the key contract-facing UI/reporting surfaces.

This work includes a production data migration for the currently shared non-template contracts, backend/schema guardrails so new cross-client sharing cannot be created, and targeted UI/reporting changes so live contract status and ownership derive from `client_contracts`.

## Problem

The repo is split between two incompatible models:

- Newer flows, especially the contract wizard, already behave like contracts are client-specific instantiated records created from templates.
- Older model/actions/API/reporting/UI code still treats non-template contracts as reusable tenant-level objects that can legitimately fan out to multiple clients and carry their own live lifecycle state.

This mismatch already causes incorrect behavior and confusing UI:

- Billing truth is assignment-first, because invoice generation filters by `client_contracts.is_active` and assignment dates.
- Contract-facing UI can still show status from `contracts.status`.
- Reports still count “active contracts” from `contracts.is_active`.
- The schema does not enforce one owning client per non-template contract.

Production currently contains two real shared-contract cases where the same non-template `contract_id` is assigned to two different clients and owns multiple contract lines, which proves the ambiguity is not theoretical.

## Goals

- Make `contract_templates` the only reusable contract-definition layer.
- Make every non-template `contracts` row require exactly one owning client.
- Keep `contracts` as the instantiated contract header and owner of contract lines/configuration.
- Keep `client_contracts` as the assignment/lifecycle window table for active/inactive dates, renewal state, and PO context.
- Make live client contract status come from `client_contracts`, not `contracts.status`.
- Migrate existing shared contracts by cloning non-template contracts per client assignment without retargeting invoice history.
- Add backend/schema guardrails so future cross-client sharing of non-template contracts is rejected.
- Update the core contract-facing UI/reporting surfaces so they reflect the client-owned model instead of the shared-contract model.

## Non-goals

- Dropping the `contracts` table.
- Collapsing all contract header fields into `client_contracts`.
- Reworking contract templates beyond preserving their role as the only reusable concept.
- Retargeting historical invoices or rewriting historical financial references.
- A full redesign of all contract screens or all reports beyond the ones directly tied to shared/live contract semantics.
- Adding operational metrics, feature flags, or observability work beyond what is needed to validate the migration.

## Users and Primary Flows

- Billing admin
  1. Starts from a contract template or creates a client-specific contract draft.
  2. Creates or resumes a non-template contract owned by one client.
  3. Activates, updates, renews, or terminates the client contract through assignment-aware flows.
  4. Generates invoices; billing resolves through the active assignment for that client.

- Finance / operations
  1. Reviews live client contracts and sees status derived from assignment lifecycle.
  2. Runs contract reports that count/display live contracts from assignment truth.
  3. Uses migration runbooks to verify shared contracts have been split cleanly.

- Engineers / support
  1. Can reason about one clear ownership rule for non-template contracts.
  2. Do not have to infer client ownership from a shared `contract_id`.

## UX / UI Notes

- Templates remain a separate reusable area in Billing.
- Live “Client Contracts” UI should be assignment-first:
  - rows sourced from `client_contracts` joined to `contracts`
  - status badge derived from assignment lifecycle
  - live activate/terminate/unassign actions mutate assignment state, not shared contract-header state
- Contract detail for live client contracts should use `clientContractId` as the primary selection context and `contractId` as the header/line lookup.
- Draft contract flows may still use contract-header draft state, but once a contract is live for a client, the UI should not imply it is a shared reusable object.

## Requirements

### Functional Requirements

- Ownership model
  - Add `contracts.owner_client_id` for non-template contracts.
  - Every non-template contract must have one owning client.
  - Every `client_contracts` row referencing a non-template contract must have `client_id = contracts.owner_client_id`.

- Data migration
  - Detect any non-template `contract_id` linked to more than one distinct `client_id`.
  - For each shared contract group, preserve the original `contract_id` on one assignment and clone contract data for the others.
  - Preservation rules:
    - if exactly one assignment has invoice history, preserve that assignment on the original `contract_id`;
    - otherwise preserve the earliest-starting assignment.
  - Clone the contract header and all contract-owned line/config child records for each non-preserved assignment.
  - Repoint each non-preserved `client_contracts.contract_id` to its cloned contract.
  - Do not retarget invoice history in this pass.
  - Fail closed if a clone-target assignment has contract-scoped document associations or other historical references whose semantics are not explicitly handled by this pass.

- Guardrails
  - Non-template contract creation in supported app flows requires an owner client.
  - Assignment create/update flows reject attaching a non-template contract to a different client than its owner.
  - Renewal-draft creation copies owner client onto the new draft contract.
  - Shared-contract creation via legacy API/action paths is blocked unless explicitly exempted for internal migration tooling.

- Live status semantics
  - For live client-contract UI/actions/reporting, status must derive from assignment state (`client_contracts.is_active`, dates, renewal workflow state).
  - `contracts.status` may remain for draft/header workflow in this pass, but it is no longer the source of truth for live client contract state.

- UI/reporting cleanup
  - Billing contract list/detail flows stop implying that non-template contracts are reusable across clients.
  - Client contract lists/actions use assignment-first data.
  - Revenue/expiration/live contract reporting uses `client_contracts` as the fact table and joins `contracts` for descriptive fields only.
  - Contract-linked document visibility must continue to resolve correctly for the owning client after shared contracts are split.
  - Contract detail must separate contract-header state from assignment state so invoices, documents, and live status do not continue to imply cross-client shared ownership.

### Non-functional Requirements

- Migration must be deterministic and idempotent enough to re-run safely in dry-run/validation contexts.
- Migration must fail closed on unsupported downstream references for non-preserved assignments instead of silently corrupting data.
- No new external dependencies.
- Keep plan scope to core behavior and correctness; do not expand into generalized contract-domain redesign work.

## Data / API / Integrations

- Schema
  - Add `contracts.owner_client_id`.
  - Update `IContract` and any related request/response types to carry owner client information where relevant.

- Actions / API
  - Contract creation/update APIs that create non-template contracts must take or derive the owning client.
  - Live contract list/detail responses should expose assignment-derived status explicitly.
  - Existing `/contracts` resource semantics remain for now, but they refer to client-owned instantiated contract headers, not reusable library items.

- Billing engine
  - Keep the `client_contracts -> contracts -> contract_lines` read shape.
  - Rely on the new ownership invariant so the contract header/lines are unambiguous for a given client assignment.
  - Keep contract-backed client line helpers correct under the same invariant so overlap checks and contract-derived client line listings cannot bleed across clients.

- Reports
  - Contract report actions and report definitions must move active/live counting to `client_contracts`.

- Documents / client portal
  - Contract-linked document visibility continues to resolve via the client-owned contract invariant after migration and guardrail changes.
  - Contract-scoped document associations must be included in migration safety checks so unsupported shared-document scenarios abort instead of silently drifting.
  - Client portal billing and document views must be audited for compatibility with cloned client-owned contracts and any remaining legacy `client_contract_lines` assumptions must be called out or corrected.

## Security / Permissions

- No new permissions are required.
- Existing billing/contract read and update permissions still gate access.
- Guardrails must prevent cross-client contract attachment even for privileged users unless an internal migration code path is explicitly used.

## Observability

- Out of scope beyond existing migration logging and validation output.

## Rollout / Migration

- Run a preflight query that identifies shared non-template contracts and classifies preserved vs clone-target assignments.
- Current known production shared contracts:
  - `Managed IT Services` in tenant `Cross Industries, LLC`
    - preserve `The Green Thumb` assignment because it has invoice history
    - clone for `BTM Machinery`
  - `Worry-Free Essentials` in tenant `WorryNot Works IT Services`
    - preserve `WorryNot Works IT Services` assignment because it has the earliest start date
    - clone for `The Benjamin Wolf Group`
- Verified current blast radius for clone-target assignments:
  - no invoices
  - no document associations
  - no pricing schedules
  - no direct `time_entries` or `usage_tracking` tied to those contract-line IDs
- After migration, validate that no non-template contract is linked to more than one distinct client.
- Abort newly discovered shared-contract groups from this migration if clone-target assignments carry contract-scoped documents or other historical references that need explicit copy/retarget semantics.

## Open Questions

- Should a later follow-up fully remove live-status dependence on `contracts.status` everywhere, or is leaving it as a draft/header-only concept sufficient long-term?
- Should `/contracts` remain the long-term API noun for client-owned instantiated headers, or should a later API cleanup rename the resource for clarity?
- If a future shared-contract edge case includes contract-scoped docs, should those docs stay only on the preserved historical contract, be copied to cloned contracts, or eventually move to assignment/client scope?

## Acceptance Criteria (Definition of Done)

- Production shared non-template contracts are split so that each non-template contract belongs to exactly one client.
- `contracts.owner_client_id` is populated for non-template contracts and enforced in normal app flows.
- Billing engine behavior remains correct for preserved and cloned assignments.
- Live contract UI surfaces derive status from `client_contracts`.
- Contract report actions no longer use `contracts.is_active` as the live fact source for active client contract reporting.
- Contract-linked client portal document visibility still resolves correctly for migrated cloned contracts.
- Unsupported shared-contract groups with contract-scoped documents fail closed during migration instead of silently producing incorrect document ownership.
- New attempts to attach a non-template contract to a different client than its owner fail with a clear error.
