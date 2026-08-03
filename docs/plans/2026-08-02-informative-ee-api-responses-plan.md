# Informative responses for EE-only API routes

## Problem

Community Edition route shells for Enterprise-only capabilities currently return unrelated bare 404 payloads such as `{ "error": "Enterprise feature" }` or `{ "error": "Not found" }`. That makes an intentionally unavailable product capability indistinguishable from a missing endpoint and gives clients no stable signal for showing the shared upgrade experience.

## Design decisions

1. Add a server-owned edition-gate response helper in the CE-safe server library. It returns a stable JSON contract with HTTP 403:
   - `error`: concise human-readable explanation
   - `code`: `EE_REQUIRED`
   - `feature`: stable machine-readable feature key
   - `message`: display-ready feature-specific copy
   - `upgrade`: structured metadata needed by the shared upgrade prompt (including the public Pro product name and an upgrade path/CTA when available)
2. Keep authentication and authorization semantics separate. The helper is used only after a route has determined the build lacks the capability; ordinary 401/403 authorization failures and genuine 404 resources retain their existing contracts.
3. Convert the identified CE route shells to the helper, starting with MCP agents and covering the same edition-gated families: MCP/discovery `.well-known` endpoints, platform notifications, platform reports, platform feature flags, tenant management, and appliance installs. Each call supplies an explicit feature key and feature name.
4. Preserve protocol-specific payloads where standards require them. OAuth discovery/authorization responses may retain required OAuth fields, but should add or map the same `EE_REQUIRED` signal where doing so is protocol-safe. Continue `Cache-Control: no-store` on discovery endpoints.
5. Add a small client-side type guard/parser for the contract and route it to the existing shared upgrade prompt/stub instead of duplicating banners. Fetch callers that currently treat every non-2xx response as “not found” should recognize `EE_REQUIRED`; other errors continue through existing handling.

## Implementation sequence

1. Inventory edition checks in `server/src/app/api/v1/**`, `server/src/app/.well-known/**`, and CE seam modules such as `packages/product-mcp/oss/entry.ts`; classify standard JSON routes versus protocol-specific routes.
2. Introduce the typed response body and helper in a CE-safe server module with a feature-key union or constants for the migrated families.
3. Replace repeated inline `NextResponse.json(..., { status: 404 })` gates in the scoped route families. Avoid changing route success behavior, EE dynamic imports, or authorization order.
4. Introduce/reuse a client parser and connect affected UI consumers to the shared upgrade prompt component delivered by alga0002208. Keep the component dependency one-way: generic API code recognizes the contract; feature screens decide how and where to render the prompt.
5. Add behavioral tests that call representative route handlers in CE mode and assert HTTP 403 plus the typed body, including no-store headers for discovery. Add client behavior tests proving `EE_REQUIRED` renders the shared upgrade stub while genuine 404 and authorization errors do not.
6. Run targeted tests, TypeScript checks for touched packages, and a CE smoke pass against at least MCP plus one platform route.

## Deliberate non-goals

- Do not expose Enterprise implementation details or dynamically import EE modules in CE.
- Do not convert genuine missing-resource 404s or ordinary permission failures.
- Do not redesign the shared upgrade prompt; consume the component owned by alga0002208.
- Do not rename unrelated “Enterprise” internals as part of this card; public-facing upgrade copy should say Pro, while edition environment identifiers may remain unchanged.
- Do not make a repository-wide conversion of every historical edition check in one change; cover the ticket’s enumerated API families and leave a reusable helper for follow-up migration.

## Risks and mitigations

- **Clients rely on 404:** migrate known consumers in the same change and document the new 403 contract.
- **Information disclosure:** feature names are product catalog metadata only; no tenant, license, or implementation details belong in the response.
- **Protocol incompatibility:** retain protocol-mandated shapes and headers, adding the signal only where compatible.
- **Partial migration:** maintain an explicit inventory/checklist in the implementation PR and test representative handlers from each route family.

## Acceptance criteria

- Scoped CE-only routes return a consistent, typed `EE_REQUIRED` response rather than a bare 404.
- The response identifies the unavailable feature and carries enough structured upgrade metadata for the shared Pro upgrade prompt.
- Affected client surfaces render the shared upgrade stub for this contract.
- Real 404, 401, and authorization 403 behavior remains unchanged.
- CE builds do not import EE implementations, and targeted behavioral tests and type checks pass.
