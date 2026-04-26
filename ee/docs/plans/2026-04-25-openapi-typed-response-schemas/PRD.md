# PRD: Type OpenAPI Success Response Data Schemas

## Status

Draft created 2026-04-25.

## Problem Statement

The OpenAPI placeholder-removal pass eliminated generated placeholder descriptions, but a spot check found that some documented operations still expose success response `data` as an untyped OpenAPI schema (`{}`), which downstream SDK generators surface as `any`.

Concrete example:

- `GET /api/v1/clients/{id}` returns `#/components/schemas/ClientContactApiSuccess`.
- `ClientContactApiSuccess.properties.data` is generated from `zOpenApi.unknown()`.
- The generated OpenAPI schema for `data` is `{}`, so consumers lose the actual client response fields.

This means the spec is no longer placeholder-based, but it is still insufficient for typed SDK generation and API consumer usability in several route families.

## User Value

- API consumers get strongly typed success payloads instead of `any`.
- Generated SDKs expose accurate entity shapes for common reads and mutations.
- Route documentation remains source-grounded and useful beyond summary/description metadata.
- Future OpenAPI regressions can be caught automatically by scanning for untyped success-response `data` schemas.

## Goals

1. Replace generic success envelopes that use `data: zOpenApi.unknown()` with typed, operation-specific response schemas.
2. Prioritize the 10 known generic success components currently producing `data: {}`:
   - `AccessApiSuccessV1`
   - `BillingOverviewResponse`
   - `ClientContactApiSuccess`
   - `ContractLineApiSuccess`
   - `FinancialInvoiceApiSuccess`
   - `MetaUtilityApiSuccessV1`
   - `QuickBooksV1ApiSuccess`
   - `QuotesContractsApiSuccessV1`
   - `WebhookApiSuccessV1`
   - `WorkV1ApiSuccess`
3. Start with the observed bug: `GET /api/v1/clients/{id}` must return a typed `Client` schema inside `data`.
4. Add reusable OpenAPI schema helpers where they reduce duplication, such as typed success and paginated envelopes.
5. Add or document a validation scan that identifies success response schemas where `properties.data` is `{}`.
6. Regenerate CE and EE OpenAPI specs after each logical batch.
7. Keep the existing zero-placeholder guarantee intact for CE and EE specs.

## Non-Goals

- Do not change runtime API responses unless a separate bug fix is requested.
- Do not fully model every dynamic metadata field if source behavior is intentionally open-ended.
- Do not redesign the API response envelope format.
- Do not block on perfect schemas for inherently dynamic/admin/debug endpoints; if needed, explicitly allowlist them with justification.
- Do not touch `.env.localtest`.

## Target Users / Personas

- External integrators using OpenAPI docs or generated SDKs.
- SDK maintainers relying on OpenAPI response schemas for generated TypeScript types.
- Alga engineers reviewing API contract accuracy.
- AI/tool-call systems that need field-level response contracts.

## Current Baseline

A generated CE spec scan found 10 response components where `data` is generated as an empty schema `{}`. These components are used by approximately 395 success responses.

Example generated schema:

```json
{
  "type": "object",
  "properties": {
    "data": {},
    "meta": {
      "type": "object",
      "additionalProperties": {}
    }
  }
}
```

Example source cause:

```ts
const ApiSuccess = registry.registerSchema(
  'ClientContactApiSuccess',
  zOpenApi.object({
    data: zOpenApi.unknown(),
    meta: zOpenApi.record(zOpenApi.unknown()).optional(),
  }),
);
```

Known affected route-family registrar files include:

- `server/src/lib/api/openapi/routes/clientsContacts.ts`
- `server/src/lib/api/openapi/routes/accessControlUsers.ts`
- `server/src/lib/api/openapi/routes/contractLines.ts`
- `server/src/lib/api/openapi/routes/financialInvoices.ts`
- `server/src/lib/api/openapi/routes/metaUtilityV1.ts`
- `server/src/lib/api/openapi/routes/quickbooksV1.ts`
- `server/src/lib/api/openapi/routes/quotesContractsV1.ts`
- `server/src/lib/api/openapi/routes/webhooks.ts`
- `server/src/lib/api/openapi/routes/workManagementV1.ts`

## Source-Grounded Example: Client Detail

`GET /api/v1/clients/{id}` implementation path:

1. `server/src/app/api/v1/clients/[id]/route.ts`
2. `ApiClientController` extends `ApiBaseController`.
3. `ApiBaseController.getById()` authenticates, checks `client:read`, extracts the path ID, calls `service.getById()`, and returns `createSuccessResponse(resource)`.
4. `ClientService.getById()` selects `clients as c`, joins account manager user data, adds `account_manager_full_name`, and appends `logoUrl`.
5. `server/src/lib/api/schemas/client.ts` already defines `clientResponseSchema` with the expected field set.

Therefore the OpenAPI response should be an envelope equivalent to:

```ts
zOpenApi.object({
  data: ClientResponseSchema,
  meta: SuccessMeta.optional(),
})
```

## Requirements

### Functional Requirements

1. `GET /api/v1/clients/{id}` `200` response must expose a typed `data` object with client fields, not `{}`/`any`.
2. Client list/create/update/stats/contact/location routes must use operation-appropriate typed success or paginated envelopes.
3. Contact routes must expose typed contact response shapes where source schemas or service returns are available.
4. Each known generic success component must either be eliminated from success responses or replaced with typed equivalents.
5. Dynamic endpoints may use bounded schemas such as arrays, records, or discriminated result objects, but must not leave `data` as bare `unknown` unless explicitly allowlisted and documented.
6. CE and EE generated specs must remain free of placeholder descriptions and `x-placeholder` metadata.

### Validation Requirements

1. Add a repeatable scan for generated schemas where object property `data` is `{}`.
2. The scan should report:
   - Component name.
   - Number of operations using it.
   - Example operations.
3. The final accepted state should have zero untyped success response `data` schemas, except explicit allowlist entries with rationale.
4. Run OpenAPI generation for CE and EE after changes.

## Implementation Strategy

1. Add shared OpenAPI schema helpers if useful, for example:
   - `successEnvelope(name, dataSchema, metaSchema?)`
   - `paginatedEnvelope(name, itemSchema, metaSchema?)`
   - `arrayEnvelope(name, itemSchema, metaSchema?)`
2. Replace broad `ApiSuccess` components one registrar at a time.
3. For each operation, map the response to the closest source-backed schema:
   - Existing Zod response schemas in `server/src/lib/api/schemas/*`.
   - Controller/service selected fields where no response schema exists.
   - Explicit minimal schemas for TODO/stub responses.
4. Regenerate specs and run scans after each route family.
5. Update the PR branch with focused commits.

## Risks and Constraints

- Some route families are broad and include many dynamic or stubbed responses. These should be modeled honestly, not over-specified.
- Existing source response schemas may not exactly match service output. Prefer source implementation behavior when mismatches are discovered.
- Large generated OpenAPI diffs are expected; keep source changes focused.
- Avoid introducing path literals that fail `npm run guard:ext-v2`.
- Do not stage or commit `.env.localtest`.

## Acceptance Criteria / Definition of Done

The job is complete when:

1. `GET /api/v1/clients/{id}` has a typed `200.application/json.schema.properties.data` shape in generated CE and EE specs.
2. Generated CE and EE specs have no untyped success response `data: {}` schemas, except documented allowlist entries if any.
3. Generated CE and EE specs still have zero placeholder operations.
4. `npm --prefix sdk run openapi:generate` succeeds.
5. `npm --prefix sdk run openapi:generate -- --edition ee` succeeds.
6. `npm run guard:ext-v2` succeeds.
7. This plan's `features.json`, `tests.json`, and `SCRATCHPAD.md` are updated with final results.
8. Changes are committed and pushed to the OpenAPI PR branch without staging `.env.localtest`.

## Open Questions

- Should the untyped-data scan become a committed npm script/CI guard, or remain a documented local validation script for this PR?
- Which dynamic debug/meta routes, if any, should be explicitly allowlisted rather than fully typed?
- Should imported source Zod schemas be reused directly in registrars, or should OpenAPI-specific schemas be maintained alongside route docs for stability?
