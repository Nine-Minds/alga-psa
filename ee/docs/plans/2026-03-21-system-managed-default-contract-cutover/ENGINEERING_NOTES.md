# Engineering Notes — System-Managed Default Contract

Date: `2026-03-21`

## Domain Model

- Identity: a system-managed default contract is a non-template contract row in `contracts` where:
  - `is_system_managed_default = true`
  - `owner_client_id = <target client>`
  - `tenant = <target tenant>`
- Authority model: the system-managed default contract is an attribution shell only. It does not act as a recurring cadence authority, service-period authority, or user-authored pricing surface.
- Assignment: every default contract must have a corresponding `client_contracts` row for the same tenant/client/contract.
- Creation trigger: created on qualifying billing-settings ensure paths (shared and package wrappers), not at client create.

## Invariants

1. At-most-one default contract per tenant+client.
2. Default contract is never template-backed (`is_template = false`).
3. Default contract is active lifecycle-safe baseline:
   - `status = 'active'`
   - `is_active = true`
4. Default contract has deterministic business naming:
   - `contract_name = 'System-managed default contract'`
   - `contract_description = 'Created automatically for uncontracted work'`
5. Default contract has deterministic owner:
   - `owner_client_id = client_id`
6. Default contract must have one reusable assignment relationship for that same client (`client_contracts`).
7. System-managed default contracts are non-authorable:
   - no contract-line authoring,
   - no pricing-schedule authoring,
   - no manual assignment/date lifecycle edits.
8. Runtime timing for unmatched default-contract work must come from client billing schedule windows (client cadence), never from default-contract recurrence metadata.

## Historical Billing Bootstrap Model

- Optional input: `billingHistoryStartDate` on billing-schedule update flows.
- Normalization: user-entered bootstrap date is normalized to the containing cycle boundary using shared cycle-anchor math (`resolveNormalizedBootstrapBoundary`).
- Regeneration policy:
  - delete/rebuild uninvoiced cycles from normalized boundary forward,
  - keep invoiced boundaries immutable,
  - block requests earlier than earliest invoiced cycle boundary.
- Convergence:
  - schedule save with bootstrap and manual effective-date cycle bootstrap both normalize through shared boundary rules,
  - generated historical cycles remain contiguous through the current date.

## Persistence Strategy

- Added marker column on `contracts`: `is_system_managed_default boolean not null default false`.
- Added uniqueness guard:
  - unique partial index on `(tenant, owner_client_id)` where `is_system_managed_default = true` and non-template.
- Resolution/ensure implementation catches uniqueness races and re-reads existing default contract.

## Ensure Primitive Contract

- Shared primitive: `ensureDefaultContractForClient(knexOrTrx, { tenant, clientId })`.
- Behavior:
  - validates client exists,
  - reuses existing marked default contract when present,
  - inserts minimal contract header + assignment when absent,
  - idempotently ensures assignment exists,
  - safe under concurrent insert race via unique-violation retry-read.
