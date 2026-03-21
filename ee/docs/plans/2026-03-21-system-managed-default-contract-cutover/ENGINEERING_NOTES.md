# Engineering Notes — System-Managed Default Contract

Date: `2026-03-21`

## Domain Model

- Identity: a system-managed default contract is a non-template contract row in `contracts` where:
  - `is_system_managed_default = true`
  - `owner_client_id = <target client>`
  - `tenant = <target tenant>`
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
