# PRD — QBO client migration off node-quickbooks

- Slug: `qbo-client-migration-off-node-quickbooks`
- Date: `2026-02-06`
- Status: Draft

## Summary

Replace the `node-quickbooks` SDK usage in `packages/integrations/src/lib/qbo/qboClientService.ts` with a small internal QuickBooks Online REST client built on `axios`, while keeping current behavior for query, create/update/read, and customer sync flows.

This is primarily a security-driven migration to remove a dependency chain anchored on deprecated `request`.

## Problem

- `packages/integrations/package.json` currently depends on `node-quickbooks`.
- `node-quickbooks@2.0.47` depends on `request@2.88.0`, which is deprecated and commonly appears in unresolved audit findings.
- We only use a narrow subset of QBO operations, but we currently pay the full dependency and risk surface of a legacy SDK.

## Goals

1. Remove `node-quickbooks` from this codebase and lockfile.
2. Preserve current functional behavior for all existing QBO integration flows.
3. Keep token refresh and secret storage behavior compatible with current tenant/app secrets.
4. Reduce security warnings related to the QBO SDK dependency chain.

## Non-goals

- Redesigning the QBO OAuth connect/callback routes.
- Adding new QBO entities beyond currently used capabilities.
- Reworking UI/UX for integration settings.

## Users and Primary Flows

- Billing admins fetch QBO Items, Tax Codes, and Terms from integration settings.
- Billing admins validate existing QBO connections (CompanyInfo checks).
- Company sync uses QBO customer lookup/create/update flows.

## UX / UI Notes

No user-facing UI changes are expected. Existing pages/actions should behave the same.

## Requirements

### Functional Requirements

- `QboClientService.create(tenantId, realmId)` continues to initialize a ready-to-use client.
- `query(selectQuery)` continues to support current query usage patterns (Item, TaxCode, Term, Customer, CompanyInfo).
- `create(entityType, data)`, `update(entityType, data)`, and `read(entityType, id)` continue to behave the same for current call sites.
- `findCustomerByDisplayName`, `createOrUpdateCustomer`, and sync-token logic remain behaviorally equivalent.
- 401 responses trigger a single token refresh and one retry for idempotent request paths currently retried.
- Error mapping remains compatible with existing `AppError` codes (`QBO_AUTH_ERROR`, `QBO_NOT_FOUND`, `QBO_STALE_OBJECT`, etc.).
- Multi-realm credential map storage format remains unchanged.

### Non-functional Requirements

- No increase in secret exposure risk (no tokens in logs).
- Keep TypeScript compile clean in affected packages.
- Remove `node-quickbooks` transitive dependency tree from lockfile.

## Data / API / Integrations

New internal REST layer targets Intuit QBO endpoints directly:

- `GET /v3/company/{realmId}/query?query=...`
- `GET /v3/company/{realmId}/companyinfo/{realmId}`
- `POST /v3/company/{realmId}/{entityType}` (create)
- `POST /v3/company/{realmId}/{entityType}?operation=update` (update)
- `GET /v3/company/{realmId}/{entityType}/{id}` (read)

Current known usage surface to preserve:

- `packages/integrations/src/actions/qboActions.ts`
- `packages/billing/src/services/companySync/adapters/quickBooksCompanyAdapter.ts`

## Security / Permissions

- Continue using `getSecretProviderInstance()` for app and tenant secrets.
- Keep credentials in `qbo_credentials` tenant secret JSON map keyed by `realmId`.
- Preserve RBAC checks already enforced in actions.

## Observability

- Keep current structured logs around QBO operations and failures.
- Preserve enough operation/entity context in errors for support/debugging.

## Rollout / Migration

### Batch 1 (commit 1)

- Introduce internal REST-backed implementation for `QboClientService` with behavior parity.
- Validate via typechecks/compiles only for this pass; unit test additions are deferred by request.
- Keep current call sites unchanged.

### Batch 2 (commit 2)

- Remove `node-quickbooks` dependency from `packages/integrations/package.json`.
- Refresh lockfile and validate dependency graph no longer includes `node-quickbooks`/`request` via this path.
- Run targeted tests and audit checks.

## Open Questions

- Do we want a short-lived fallback toggle to legacy SDK during rollout, or proceed directly with full cutover?
- Should update requests explicitly use sparse semantics for all entity updates, or only where currently required by behavior?
- Do we need to pin and expose a configurable QBO `minorversion` in the new REST implementation?

## Acceptance Criteria (Definition of Done)

- `node-quickbooks` is fully removed from package manifest and lockfile.
- Existing QBO flows still work:
  - item/tax/term catalog fetch
  - CompanyInfo validation
  - customer lookup/create/update sync flow
- QBO token refresh path still updates tenant secrets and retries failed auth once where expected.
- Error codes/messages remain compatible with existing handling paths.
- Targeted tests for QBO client/service pass.
- Security audit shows reduction of warnings associated with `node-quickbooks` dependency chain.
