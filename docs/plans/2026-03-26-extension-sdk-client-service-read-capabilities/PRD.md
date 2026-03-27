# PRD — Extension SDK Client And Service Read Capabilities

- Slug: `extension-sdk-client-service-read-capabilities`
- Date: `2026-03-26`
- Status: Draft

## Summary

Add read-only extension host capabilities for tenant-scoped client and service catalog lookup so extension handlers can read those records without making HTTP API calls.

## Problem

Handlers that need client lists or service catalog data currently have to rely on API-like transport patterns. That creates unnecessary coupling to routes and credentials and makes scheduled or webhook-driven extension execution awkward.

## Goals

- Add first-class host capabilities for reading clients and services from extension handlers.
- Support both user-backed and non-user execution contexts.
- Keep the extension contract typed, small, and versionable.
- Reuse existing internal query logic instead of duplicating API controllers.
- Enforce capability grants, RBAC behavior, and tenant isolation in one place.

## Non-goals

- Mutating clients or services.
- Exposing arbitrary database queries.
- Returning the full internal `IClient` or `IService` shapes.
- Replacing existing HTTP APIs for the web app.

## Users and Primary Flows

- Extension authors building tenant automations that need lookup data.
- Scheduler-driven handlers that need to read clients or services without a user session.
- Webhook-style handlers that need service catalog context during execution.

Primary flows:

- Extension lists clients with simple pagination and search.
- Extension fetches one client by id.
- Extension lists service catalog entries with simple filters.
- Extension fetches one service by id.

## UX / UI Notes

This work is backend and SDK facing. The main user-facing ergonomics are:

- extension authors import typed host bindings
- handlers avoid HTTP fetches to Alga
- capability names remain explicit in manifests

## Requirements

### Functional Requirements

- Introduce `cap:client.read` and `cap:service.read`.
- Add `clients.list`, `clients.get`, `services.list`, and `services.get` host operations.
- Return summary-shaped records rather than full internal entities.
- Support pagination and a minimal filter set for list operations.
- Enforce normal `client:read` and `service:read` permissions when a user is present.
- Allow capability-only tenant-scoped access for non-user contexts.
- Return nullable results for not-found `get` operations.

### Non-functional Requirements

- No handler-side HTTP dependency for these reads.
- Stable WIT and TypeScript surface for SDK consumers.
- Clear error semantics for not-allowed, invalid-input, and internal failures.
- Provider behavior must be unit testable without UI or HTTP routing.

## Data / API / Integrations

- Extend extension runner WIT with `clients` and `services` interfaces.
- Extend `sdk/extension-runtime` host bindings and mocks.
- Add runner capability providers for both interfaces.
- Extract or factor shared read services from the current client and service action layers.

Likely internal reuse points:

- `packages/clients/src/actions/clientActions.ts`
- `packages/billing/src/actions/serviceActions.ts`

## Security / Permissions

- Install capability grant is mandatory.
- User-backed executions must also pass the existing RBAC checks.
- Non-user executions may read tenant-scoped data when the install capability is granted.
- Extensions cannot override tenant id in capability input.

## Observability

- Provider calls should emit structured runner logs for capability name, tenant, extension, result count, and error type.
- Failures should distinguish capability denial, RBAC denial, invalid input, and internal query failure.

## Rollout / Migration

- Add the new capabilities behind normal manifest capability declarations.
- Ship a sample extension that exercises the new host APIs.
- Keep existing HTTP-based patterns working; this is additive.

## Open Questions

- Include tags in client summaries in v1 or defer.
- Include currency-specific prices in service summaries in v1 or defer.
- Decide whether future write support should be separate capabilities.

## Acceptance Criteria (Definition of Done)

- Extensions can read clients through a typed host capability without HTTP.
- Extensions can read services through a typed host capability without HTTP.
- User-backed execution respects existing `client:read` and `service:read` permissions.
- Non-user execution works when the install capability is granted.
- The SDK exposes typed bindings and mock bindings for both capabilities.
- Runner/provider tests cover user, non-user, denial, invalid input, not-found, and tenant isolation cases.
- A sample extension demonstrates end-to-end usage.
