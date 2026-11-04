# Hosted MCP `search_api_registry` request-body parity — plan

Card: f4683b7c-038a-422b-8c6a-94030ff9b060 · PSA ticket: alga0002071 (follow-up to PR #3659)
Branch: `feature/hosted-mcp-search-api-registry-omits-requestbody`

## Problem

Three surfaces run the same ranked registry search (`searchRegistryEntries`,
`packages/agent-tooling/src/registry/search.ts:304`), and each one maps the hits
into its own result shape:

| Surface | Mapper | requestBodySchema | description | examples | summary | note |
|---|---|---|---|---|---|---|
| Hosted MCP `/api/mcp` | `ee/server/src/lib/mcp/jsonRpcServer.ts:102-117` (`dispatchTool`) | **missing** | **missing** | **missing** | yes | **missing** |
| Stdio connector | `packages/alga-mcp-connector/src/tools.ts:29-62` (`handleSearchApiRegistry`) | yes | yes | first only | yes | yes |
| In-app chat | `ee/server/src/services/chatCompletionsService.ts:1199-1229` (`searchRegistry`) | **missing** | yes | first only | **missing** | **missing** (and uses `id` rather than `entryId`, no `score`) |

All three duplicate the argument handling as well: the empty-query check and the
`limit` clamp (default 5, max 25). That code lives in `jsonRpcServer.ts:65-69, 104-106`,
`tools.ts:13-17, 33-37` and `chatCompletionsService.ts:1200-1208`.

The hosted tool's own advertised description (`packages/agent-tooling/src/tools/definitions.ts:64-67`)
promises "parameters, schema, examples", which the hosted server doesn't deliver. Because
of this, hosted MCP clients and the in-app assistant can't see write-body shapes such as
contact `phone_numbers[]` items or `POST /time-entries`, so they have to guess payloads.
PR #3659 corrected those shapes in the registry, and the shapes are present in both
generated registries (`server/src/lib/mcp/registry.generated.ts`, and
`ee/server/src/chat/registry/apiRegistry.generated.ts`, which chat uses). They are
dropped only at projection time.

**The in-app chat path has the same omission.** It never surfaces `requestBodySchema`.

## Decision summary

1. **One shared projection plus one shared tool runner, in `@alga-psa/agent-tooling`,
   next to `searchRegistryEntries`.** New module `packages/agent-tooling/src/registry/searchResult.ts`.
   It owns: input coercion (query/limit), the ranked search call, the per-hit projection,
   and the response envelope (`query`, `count`, `results`, `note`). All three surfaces call
   it, and none of them builds hit objects itself. The engine is the layer that knows what a
   "search hit" is. The transports only decide how to serialize it.
2. **Full `requestBodySchema` inline, no trimming or capping.** This is based on measured
   data, not a guess (both generated registries, 2026-10-13):
   - 832 entries, of which 346 have a body schema. Serialized schema size: p50 236 B,
     p90 895 B, p99 3.2 KB, max 3.35 KB (`POST /api/v1/contacts`; webhooks ≈3.27 KB).
     Max description is 1.5 KB and max first example is 1.2 KB.
   - Default `limit=5` with typical hits is a few KB. The theoretical worst case, 25 hits
     that are all the largest entries, is about 150 KB compact. That case is unrealistic
     and still within MCP/LLM tool-result tolerances.
   - Trimming would bring back the exact failure this card fixes (agents guessing nested
     shapes such as `phone_numbers.items`). A partial schema is worse than none because it
     looks authoritative.
   - Guard: a size-budget test fails if any registry entry's serialized
     `requestBodySchema` exceeds 16 KB. That forces this decision to be revisited, for
     example in favour of a `describe_endpoint` tool, before payloads drift large.
3. **The hit shape is the connector's current shape, which becomes canonical:**
   `entryId, displayName, method (UPPER), path, summary, description, parameters,
   requestBodySchema, approvalRequired, score (2dp), examples (first only)`, and the
   envelope `note` when the top score is below 3. Two refinements apply to every surface:
   - `description` is omitted when it equals the auto-generated placeholder text
     (`PLACEHOLDER_DESCRIPTION`, `search.ts:3-4`), because it adds nothing for the model.
   - Absent fields are left `undefined`, so `JSON.stringify` drops them. No `null`s and
     no empty `[]` examples.
4. **Chat moves to the same projection.** Chat's executor already accepts
   `entryId ?? id ?? name` (`chatCompletionsService.ts:530-543, 1154-1160`), so renaming
   `id` to `entryId` in search output is safe and matches the `entryId` parameter of the
   execute tool. Chat's `tags` field is dropped. Tags are a ranking signal, not something
   the model needs to call the endpoint.
5. **Anti-drift contract:** an EE test drives the real `/api/mcp` handler and asserts that
   its `search_api_registry` result deep-equals the shared runner's output for the same
   registry and query. It also asserts that `POST /api/v1/contacts` carries
   `requestBodySchema` with `phone_numbers.items`. If anyone reintroduces a local mapper,
   this test fails.

## Changes, in order

### 1. Engine: `packages/agent-tooling`

- **New `src/registry/searchResult.ts`:**
  ```ts
  export const REGISTRY_SEARCH_DEFAULT_LIMIT = 5;
  export const REGISTRY_SEARCH_MAX_LIMIT = 25;
  export const LOW_CONFIDENCE_SCORE = 3;

  export interface RegistrySearchHit {
    entryId: string; displayName: string; method: string; path: string;
    summary?: string; description?: string;
    parameters: ChatApiParameter[]; requestBodySchema?: unknown;
    approvalRequired: boolean; score: number; examples?: ChatApiExample[];
  }
  export interface RegistrySearchResponse {
    query: string; count: number; results: RegistrySearchHit[]; note?: string;
  }
  export function toRegistrySearchHit(r: RegistrySearchResult): RegistrySearchHit;
  export function runRegistrySearch(
    registry: ChatApiRegistryEntry[],
    args: { query?: unknown; limit?: unknown },
  ): { ok: true; data: RegistrySearchResponse } | { ok: false; error: string };
  ```
  `runRegistrySearch` trims and validates the query (error text stays
  `search_api_registry requires a non-empty "query".`), clamps the limit with the existing
  `clampInt` semantics (finite int, 1..25, default 5), calls `searchRegistryEntries`, maps
  each hit through `toRegistrySearchHit`, and adds `note` with the connector's current
  wording.
- **`src/registry/search.ts:3-4, 126-133`:** export `isPlaceholderDescription(text)` (or the
  constant) so the projection and `hasPlaceholderMetadata` share one definition.
- **`src/index.ts:1-4`:** add `export * from './registry/searchResult';`.
- **`package.json` `exports`:** add a `./registry/searchResult` subpath, matching the existing
  `./registry/search` entry.
- **`src/tools/definitions.ts:64-67`:** correct the `search_api_registry` description to name
  the real fields: "Returns ranked endpoint descriptors (entryId, method, path, parameters,
  requestBodySchema for write endpoints, and an example). Use requestBodySchema to build
  call_api_endpoint bodies." Also state the `limit` maximum (25) in the `limit` param
  description at :74-77.
- **New `src/registry/__tests__/searchResult.test.ts`:**
  - A hit for an entry with a body schema includes `requestBodySchema` deep-equal to the entry's.
  - `description`, `summary` and `examples` (first only) are carried through. The placeholder
    description is omitted.
  - An entry with no schema or examples has no such keys after a JSON round-trip.
  - Limit clamp: default 5, max 25, garbage input falls back to 5. An empty or whitespace
    query returns `{ ok: false }`.
  - `note` appears only when the top score is below 3.

### 2. Stdio connector: `packages/alga-mcp-connector`

- **`src/tools.ts:13-17, 29-62`:** delete `clampInt` (if nothing else uses it) and the local
  mapper. `handleSearchApiRegistry` becomes a thin adapter:
  `const r = runRegistrySearch(registry, args); return r.ok ? { data: r.data, isError: false } : { data: { error: r.error }, isError: true };`.
  The connector's output is unchanged apart from the placeholder-description omission.
- **`src/__tests__/tools.test.ts:36-49`:** add a registry fixture entry with a
  `requestBodySchema` and assert that it is surfaced.
- tsup bundles agent-tooling (it is a devDependency), so no publish or dependency changes are needed.

### 3. Hosted MCP: `ee/server/src/lib/mcp/jsonRpcServer.ts`

- **:2-11 imports:** add `runRegistrySearch`.
- **:102-117:** replace the branch with:
  `const r = runRegistrySearch(ctx.registry, args); return r.ok ? toolOk(r.data) : toolErr(r.error);`.
- **:65-69 `clampInt`:** keep it only if something still uses it. After this change nothing
  does (search_business_data passes `limit` through), so delete it.
- **:77-81 `resolveEntry`:** add a `// LEVERAGE: pattern registry-resolve-entry` marker
  (duplicated in `tools.ts:20-27` and in chat's richer `resolveRegistryEntry`). Not in scope
  for extraction here.

### 4. In-app chat: `ee/server/src/services/chatCompletionsService.ts`

- **:1199-1229 `searchRegistry`:** call `runRegistrySearch(getRegistry(), { query, limit })`.
  Keep the existing `registry_search_empty_query` warn and the `registry_search` debug log
  (`summarizeRegistryResults` still needs the raw ranked results, so either log from
  `searchRegistryEntries` before projecting, or log from the projected hits by switching
  `summarizeRegistryResults` (:277-286) to accept `RegistrySearchHit[]`). The second option
  is preferred: one search pass, no raw-result dependency.
  Return the `RegistrySearchResponse`. On an empty query, return `{ error }` instead of `[]`
  so the model gets the same error as on MCP.
- **:464-489:** send the response object as the function result instead of wrapping it in
  `{ results }`. That gives `{ query, count, results, note }`, the same envelope MCP clients see.
- **:986-1008 chat tool definition:** align the `limit` description ("default 5, max 25").
  Leave the rest of chat's separately-built tool definitions alone (out of scope, see below).
- **`server/src/test/unit/services/chatCompletionsService.unit.test.ts` :356-363, :410-…, :443-…,
  :505-…:** `searchRegistry(...)` now returns the envelope. Change assertions to
  `results.results[0]` with `entryId` in place of `id`. Add one assertion that a create-intent
  hit carries `requestBodySchema` (the fixture at :347-350 already has one).

### 5. Hosted contract test (new)

**`ee/server/src/__tests__/unit/mcpSearchApiRegistry.contract.test.ts`** (or
`server/src/test/unit/...`, whichever vitest project resolves both `@ee/lib/mcp/*` and
`@/lib/mcp/loadRegistry`; the existing `ee/server/src/__tests__/unit/mcp*.test.ts` set the
pattern):
- Mock only the auth seam: `ApiKeyServiceForApi.validateApiKeyAnyTenant` resolves a key record.
  Also mock `@/lib/features` `isEnterpriseEdition`, so that it returns `false`, to pin the
  CE generated registry deterministically. `@product/chat/entry` is not reliably importable
  in unit tests.
- Build a `NextRequest` POST to `/api/mcp` with `x-api-key` and a JSON-RPC
  `tools/call` `search_api_registry` `{ query: "create contact", limit: 5 }`, and call
  `handleMcpJsonRpc`.
- Assert:
  1. A hit with `method: 'POST', path: '/api/v1/contacts'` exists and has
     `requestBodySchema.properties.phone_numbers.items` (an object with properties). This is
     the regression for alga0002071 shapes on the hosted surface.
  2. A `create time entry` query yields `POST /api/v1/time-entries` with a non-empty
     `requestBodySchema`.
  3. **Parity:** the parsed `content[0].text` deep-equals
     `runRegistrySearch((await loadMcpRegistry()).entries, sameArgs).data`. This is the
     anti-drift lock.
  4. **Size budget:** every entry in the loaded registry has
     `JSON.stringify(requestBodySchema ?? '').length <= 16_384`.

### 6. Verify

- `npx vitest run` in `packages/agent-tooling` and `packages/alga-mcp-connector`, then
  `npm run typecheck` in the connector.
- Run the EE contract test and the chat unit test file through their vitest projects.
- Typecheck `ee/server` and `server` (or the repo's affected-typecheck target).
- Live smoke on the dev server (`http://feature-hosted-mcp-search-api-registry-omits-requestbody.localhost:3486`):
  POST `/api/mcp` `tools/call search_api_registry {"query":"create contact"}` with a local API
  key and confirm that `requestBodySchema` appears. The stack-up verification failed earlier
  on this card; if the dev stack still isn't answering, report that rather than skip the step.

Each step is one commit, in the order above. Step 1 must land first because steps 2-4
depend on it. Steps 2, 3 and 4 are independent. Step 5 depends on 1 and 3.

## Out of scope

- Extracting `resolveEntry` / `clampInt` for `call_api_endpoint` across surfaces. Marked
  with a LEVERAGE marker only.
- Compact versus pretty JSON in MCP tool text (`textContent` uses `JSON.stringify(…, null, 2)`
  on both MCP surfaces; compact output would roughly halve tokens). This applies to every
  tool, not just search, and is a separate decision.
- Converging chat's hand-built tool definitions (`buildToolDefinitions`, :983-1150) on
  `buildMetaToolDefinitions`. Chat has Vertex-specific schema quirks and extra tools.
- Any registry content or generator changes (PR #3659 already corrected the shapes), and
  adding a separate `describe_endpoint` tool. The size budget test is the tripwire for the latter.
- The `GET /api/v1/meta/mcp-registry` endpoint and the OpenAPI doc, which already expose the full schemas.

## Risks

- **Chat behaviour shift.** Search results get larger (schemas) and are keyed `entryId`.
  Chat's search result bypasses the 12 KB `MAX_TOOL_RESULT_CHARS` replay cap
  (`chatCompletionsService.ts:59, 3707-3730`; search content is stringified directly at
  :478), so a `limit=25` search on write-heavy queries could add tens of KB to context.
  Mitigation: the default stays at 5, and the measured p90 is about 0.9 KB per schema. If
  this shows up in practice, route search results through `serializeToolResultForConversation`.
  Do not trim the schemas.
- **Removing `tags` from chat hits.** Low risk. The system prompt
  (:2776-2779) doesn't reference tags from search output.
- **Hosted EE registry differs from CE.** `loadMcpRegistry` serves `eeMcpRegistry` in EE
  builds. The contract test pins CE. The parity assertion and projection are
  registry-agnostic, so EE gets the same shape. The size budget runs on CE only; the EE
  artifact is built from the same generator, and it measured identically today.
- **External MCP clients parsing hosted output.** Change is additive: new fields, and
  `note` appears on weak matches. No existing field is renamed or removed on the hosted surface.
- **Unrelated working-tree noise.** `package-lock.json` is modified by the Wire Up step.
  Don't include it in any commit on this branch.
