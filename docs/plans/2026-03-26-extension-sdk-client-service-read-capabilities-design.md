# Extension SDK Read-Only Client And Service Capabilities Design

- Date: `2026-03-26`
- Status: `Approved in chat`

## Summary

Add first-class read-only extension host capabilities for tenant-scoped client and service catalog data so extension handlers can query those records without making HTTP API calls.

The preferred solution is to extend the extension runner and SDK with typed host imports, following the same pattern already used for `user`, `scheduler`, and `invoicing`.

## Problem

Extensions can currently reach Alga data through HTTP-oriented paths, but that is the wrong abstraction for common internal lookups like client lists or service catalog reads. It forces handlers to depend on API routes, credentials, and transport concerns instead of using a stable host capability contract.

This is especially awkward for scheduled jobs and webhook-style execution where there may be no authenticated user session but the extension still needs tenant-scoped reference data.

## Goals

- Let extension handlers read clients and service catalog entries without using HTTP APIs.
- Keep the contract typed and versionable at the WIT and SDK layers.
- Support both user-backed execution and non-user execution.
- Reuse existing domain query logic instead of duplicating controller behavior.
- Enforce capability grants and tenant isolation centrally in the runner.

## Non-goals

- Creating, updating, or deleting clients or services.
- Exposing arbitrary database queries to extensions.
- Mirroring the full internal `IClient` and `IService` shapes in the public extension contract.
- Replacing existing REST endpoints for product UI usage.

## Recommended Approach

Implement two new runner-native host capabilities:

- `cap:client.read`
- `cap:service.read`

Expose them through typed WIT imports:

- `alga:extension/clients`
- `alga:extension/services`

Extension code will call host bindings such as:

- `host.clients.list(...)`
- `host.clients.get(...)`
- `host.services.list(...)`
- `host.services.get(...)`

This keeps handler code transport-free and makes the runner the boundary where capability checks, permission behavior, and data mapping are enforced.

## Alternative Approaches Considered

### 1. Generic data query capability

Expose a single `host.data.query(resource, filters)` surface.

Why not:

- weaker typing
- harder documentation and evolution
- easy to grow into an implicit internal API clone

### 2. SDK helper over existing HTTP routes

Hide HTTP APIs behind SDK helpers.

Why not:

- still API-based
- still couples extensions to route semantics
- does not satisfy the stated goal cleanly

## Proposed API Boundary

The v1 contract should return stable summary types, not the entire internal record shapes.

### Client Summary

```ts
type ClientSummary = {
  clientId: string;
  clientName: string;
  clientType?: 'company' | 'individual' | null;
  isInactive: boolean;
  defaultCurrencyCode?: string | null;
  accountManagerId?: string | null;
  accountManagerName?: string | null;
  billingEmail?: string | null;
  tags?: string[];
}
```

### Service Summary

```ts
type ServiceSummary = {
  serviceId: string;
  serviceName: string;
  itemKind?: 'service' | 'product';
  billingMethod: 'fixed' | 'hourly' | 'usage';
  serviceTypeId: string;
  serviceTypeName?: string;
  defaultRate: number;
  unitOfMeasure: string;
  isActive?: boolean;
  sku?: string | null;
}
```

### Operations

- `clients.list(input)`
- `clients.get(clientId)`
- `services.list(input)`
- `services.get(serviceId)`

### List Filters

Clients:

- `search`
- `includeInactive`
- `page`
- `pageSize`

Services:

- `search`
- `itemKind`
- `isActive`
- `billingMethod`
- `page`
- `pageSize`

### Response Shape

List operations should return:

```ts
{
  items: T[];
  totalCount: number;
  page: number;
  pageSize: number;
}
```

`get` operations should return `option<T>` / nullable results for not-found instead of throwing.

## Authorization Model

Capability grants and application permissions are separate checks.

### Capability Checks

- Missing install capability returns `not-allowed`.
- `cap:client.read` gates all client reads.
- `cap:service.read` gates all service reads.

### User-Backed Requests

When the runner execution includes a real user:

- client reads also require normal `client:read`
- service reads also require normal `service:read`

This prevents interactive extensions from bypassing RBAC.

### Non-User Requests

When the execution has no user context, such as scheduled runs or webhooks:

- allow reads when the install has the capability
- execute as tenant-scoped extension service access

This supports automation use cases without requiring a synthetic user session.

### Tenant Isolation

Tenant identity always comes from runner execution context. The extension cannot supply or override tenant identifiers in capability inputs.

## Error Model

Suggested error set:

- `not-allowed`
- `invalid-input`
- `internal`

`not-available` is likely unnecessary for these read capabilities.

## Implementation Shape

### SDK / WIT

Extend the extension runtime WIT and TypeScript host bindings with:

- `clients` interface
- `services` interface
- result types and error enums
- mock host bindings for tests

### Runner

Add capability providers that:

- read tenant, install, and optional user context from the execute payload
- verify install capability grants
- apply user permission checks when a user is present
- call shared server-side read services
- map internal records into summary response types

### Shared Read Services

Do not call existing `withAuth` server actions directly from the runner provider.

Instead, extract shared query logic from:

- `packages/clients/src/actions/clientActions.ts`
- `packages/billing/src/actions/serviceActions.ts`

into pure read services that accept:

- `tenantId`
- filters / pagination
- optional actor context for permission-aware behavior

This keeps the runner capability path reusable and testable without HTTP or Next.js server action wrappers.

## Testing Strategy

### Runtime Contract Tests

Validate:

- WIT bindings compile and map correctly
- `sdk/extension-runtime` host typings and mocks include the new capabilities
- wrapper code can import and call the new host functions

### Provider Tests

Cover:

- user present and permission granted
- user present and permission denied
- no user present with capability granted
- invalid filter and pagination inputs
- not-found behavior for `get`
- tenant isolation

### End-To-End Sample Extension

Add a sample extension that:

- lists clients
- lists services
- gets a single client by id
- gets a single service by id

Validate it through:

- direct runner execute
- iframe path through `callHandlerJson`

## Risks

- Returning full internal record shapes would create long-term contract drift pressure.
- Reusing existing server actions directly would over-couple the runner to HTTP and auth wrappers.
- Non-user execution requires careful capability gating so scheduled or webhook runs remain powerful but bounded.

## Open Questions

- Whether tags should be included in `ClientSummary` v1 or deferred if they materially expand query cost.
- Whether services should expose currency-specific prices in v1 or keep only `defaultRate`.
- Whether future write capabilities should remain separate (`cap:client.write`, `cap:service.write`) rather than extending these read surfaces.

## Decision

Proceed with typed, read-only runner-native capabilities for clients and services, using capability-based authorization with conditional user RBAC enforcement and shared read services under the runner provider layer.
