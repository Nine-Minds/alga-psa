# Chat Function Calling Migration Plan

## Goal
Modernize the client chat experience to use OpenAI-style function calling contracts while temporarily simplifying the transport to single-response (non-streaming) requests.

## Scope
- DefaultLayout-integrated chat UI (`Chat.tsx`, `Message.tsx`, `RightSidebarContent.tsx`).
- `/api/chat/stream/*` Next.js routes and the EE `ChatStreamService` entry point.
- Supporting types, helpers, and tests touched by the request/response contract.
- API key lifecycle components (`ApiKeyService`, REST API middleware) for vending scoped, temporary keys.

## Constraints & Assumptions
- Switch to non-streaming HTTP responses for the initial iteration; we can reintroduce streaming after the function call flows are stable.
- Maintain current authentication/session handling, message persistence, and feedback UX.
- EE service remains the authority for model invocations; we adapt its output shape but do not reimplement core business logic.

## Phased Implementation Plan

### Phase 0 – Discovery & Alignment
1. **Current Flow Audit**: Document the end-to-end request/response path across `Chat.tsx`, `/api/chat/stream/*`, and `ChatStreamService`, capturing payload shapes, persistence hooks, and UX triggers.
2. **Stakeholder Alignment**: Share findings with product/EE stakeholders to confirm expectations for non-streaming behavior, telemetry, and rollout sequencing.

### Phase 1 – Contract Definition
1. **Schema Drafting**: Define TypeScript types and JSON schema for the OpenAI-style response, including `choices[*].message`, `function_call`, and error envelopes.
2. **Helper Utilities**: Introduce shared helpers (serialization, validation) in a neutral package so client and server consume the same contract.
3. **Migration Flagging**: Decide on feature flag or environment toggle names to gate the new contract during rollout.
4. **Approval Policy Design**: Specify the approval rules for function invocation (model-driven vs. user-confirmed), including required metadata and persistence hooks.

### Phase 2 – Temporary API Key Vending
1. **RBAC & Auth Review**: Map how `ApiKeyService`, `ApiKeyServiceForApi`, and `withApiKeyAuth` derive tenant + user context to ensure temporary keys inherit permissions.
2. **Ephemeral Key Design**: Extend the `api_keys` schema with `purpose`, `metadata` (jsonb), `usage_limit`, and `usage_count` columns; define `purpose = 'ai_session'` for chat-issued keys, default `usage_limit = 1`, `usage_count = 0`, and set `expires_at = now() + interval '30 minutes'`.
3. **Minting Workflow**: Add a `TemporaryApiKeyService.issueForAiSession` helper that wraps `ApiKeyService.createApiKey`, writes the discriminator/metadata (`chat_id`, `function_call_id`, `approval_id`, issued by user, approval timestamp), and returns `{ apiKey, expiresAt }` to the chat orchestrator.
4. **Revocation & Cleanup**: Update validation helpers to increment `usage_count` atomically and deactivate keys when `usage_count >= usage_limit` or if the associated approval is revoked; schedule a `cleanup-expired-ai-keys` pg-boss job (every 10 minutes) to deactivate lingering expired keys and emit audit logs.
5. **Access Mediation**: Enhance `ApiKeyService.validate*` and `withApiKeyAuth` to surface `purpose`/metadata in the request context, enforce tenant binding via `runWithTenant`, and short-circuit if a key is outside its intended scope (e.g., mismatched `chat_id` or function).
6. **OpenAPI Extraction Pipeline**: Build `ee/scripts/generate-chat-registry.ts` to consume the enterprise spec (`sdk/docs/openapi/alga-openapi.ee.json` or `/api/v1/meta/openapi`), filter callable routes, merge overrides, and emit `ee/server/src/chat/registry/apiRegistry.generated.ts`.

### Phase 3 – Server Adaptation
1. **Endpoint Refactor**: Create or repurpose an `/api/chat` handler that produces the non-streaming response while delegating business logic to EE services.
2. **EE Service Adapter**: Implement an adapter that buffers the existing streaming output, assembles the final message, and maps it into the contract; skip legacy model support (function calling becomes the standard path).
3. **Legacy Path Coexistence**: Guard the legacy streaming handler behind a runtime flag to ensure staged rollout and allow quick fallback.
4. **Temporary Key Integration**: When a function call is approved, invoke `TemporaryApiKeyService.issueForAiSession` and inject key details into the response payload; log issuance and propagate audit context.
5. **Deferred Execution**: Ensure server-side function execution is gated by explicit user approval, queuing the call until approval is granted (or rejected) before issuing credentials.

### Phase 4 – Client Integration
1. **API Client Update**: Point chat mutations to the new non-streaming endpoint and update request payloads as needed.
2. **Function Call Handling**: Parse `function_call` responses, trigger approval flows when required, and render call progress/results inline with the chat history; surface temporary key expiry countdown when relevant.
3. **Approval UX**: Add user-facing prompts/notifications for pending approvals, including acceptance/denial actions and surfaced audit metadata; record approval outcomes alongside key issuance metadata.
4. **UX Adjustments**: Ensure cancel/stop controls degrade gracefully, update loading states to reflect non-streaming responses, and handle key revocation (e.g., expiry) with user-facing messaging.

### Phase 5 – Quality & Validation
1. **Automated Tests**: Expand unit/integration coverage across client and server for both plain and function-call responses; include TTL/usage_limit enforcement tests for temporary keys.
2. **Approval Flow Validation**: Add automated and manual tests that cover approval-required invocations, rejected calls, audit logging, and forced expiry cleanup.
3. **Manual QA**: Outline manual verification scripts for internal testers, including regression scenarios for message persistence, approvals, feedback flows, and key revocation.
4. **Telemetry Review**: Verify logging/metrics capture the new contract fields, approval outcomes, and key issuance/consumption events; adjust dashboards or alerts as needed.

### Phase 6 – Rollout & Cleanup
1. **Staged Deployment**: Enable the new flow in staging, then for internal users, before general release; monitor errata and rollback levers.
2. **Code Cleanup**: Remove or archive unused streaming-specific code paths once adoption is complete.
3. **Future Streaming Work**: Document follow-up tasks to reintroduce streaming with the function-call contract and track them in roadmap tooling.

## Risks & Mitigations
- **Regression in chat UX**: Mitigate with feature flag or progressive rollout and thorough manual QA.
- **Function call mismatch**: Define strict TypeScript types and logging around contract translation.
- **Performance hit from non-streaming**: Monitor response times; ensure backend can produce complete messages promptly.
- **Approval bypass or deadlocks**: Enforce approval middleware server-side and include alerting for stuck or rejected calls.
- **Key leakage or privilege escalation**: Scope temporary API keys tightly (short TTL, single-conversation linkage) and log issuance/usage for auditing.

## Design Details

### Temporary API Key Data Model
- **New Columns** (`api_keys` table): `purpose` (varchar, default `'general'`), `metadata` (jsonb, nullable), `usage_limit` (integer, nullable), `usage_count` (integer, default `0`).
- **TTL Handling**: Reuse existing `expires_at`; issue AI session keys with `expires_at = now() + interval '30 minutes'`, minting a new key if an active one is absent or expired.
- **Metadata Shape** (stored as JSON): `{ chat_id, function_call_id, approval_id, issued_by_user_id, issued_at, approved_by_user_id, approved_at }`.
- **Indexes**: Add composite index on `(purpose, expires_at)` to speed cleanup scans and `(purpose, metadata->>'chat_id')` if needed for auditing.

### Key Issuance Flow
1. Add optional parameters to `ApiKeyService.createApiKey` (purpose, metadata, usageLimit, expiresAt) and mirror them in `ApiKeyServiceForApi`.
2. Chat backend requests `TemporaryApiKeyService.issueForAiSession({ userId, chatId, functionCallId, approvalId })`.
3. Service verifies approval state, sets `usage_limit = 1`, `expires_at = now() + 30 minutes`, logs issuance (structured log + audit event), and returns plaintext key + expiry + key uuid. If a valid key already exists for the conversation, deactivate it and mint a fresh one.
4. Chat response embeds `{ api_key, expires_at, key_id }` into the OpenAI function-call payload so the AI has necessary credentials.

### Key Consumption & Enforcement
1. Downstream API handlers continue to use `withApiKeyAuth`; extend validation to fetch `purpose`, `metadata`, and `usage_limit`.
2. On each request, increment `usage_count` in a transaction; if the count exceeds the limit or the key is expired/inactive, return 401 and deactivate.
3. Enforce scope checks using metadata (e.g., ensure `chat_id` matches request header/context, ensure only approved function endpoints are callable); rely on existing RBAC permissions to gate endpoint access—no additional allowlist layer required.
4. Surface key details on the `req.context` object so authorization layers can make chat-aware decisions (e.g., map to the issuing user for RBAC checks).

### Revocation & Cleanup
1. Immediate cleanup: when the AI reports function completion or approval is revoked, call `TemporaryApiKeyService.revoke(keyId, reason)` to deactivate key and annotate metadata.
2. Scheduled cleanup: add pg-boss job `cleanup-expired-ai-keys` that runs every 10 minutes, selecting `purpose = 'ai_session'` keys with `expires_at < now()` and `active = true`, deactivating them and logging summary metrics.
3. User sign-out/tenant disable: hook into existing sign-out flows to revoke outstanding AI session keys for that user.

### Telemetry & Auditing
- Emit structured logs on issuance, consumption, revocation, and failed validations (include tenant, chat_id, key_id, reason).
- Send audit events to existing security/audit trail (if available) so administrators can review AI-initiated actions.
- Track metrics via existing OpenTelemetry/PostHog instrumentation (number of keys issued, consumption success/failure, cleanup counts).

### Function Call Definition Architecture
- **Registry Source** (`ee/server/src/chat/registry`):
  - `apiRegistry.schema.ts`: Zod schema + TypeScript types describing each callable endpoint (id, name, description, tags, RBAC hints, required params, examples).
  - `apiRegistry.overrides.ts`: developer-maintained map of task metadata (playbooks, grouping, curated examples) produced from YAML/JSON files under `ee/docs/api-registry/`.
  - `apiRegistry.generated.ts`: build artifact from `ee/scripts/generate-chat-registry.ts` combining the enterprise OpenAPI spec with overrides.
  - `apiRegistry.indexer.ts`: optional helper to embed/serialize registry entries for semantic search (exports vector metadata for Postgres/pgvector or local cosine search).
- **Tool Implementations** (`ee/server/src/chat/tools`):
  - `searchApiRegistryTool.ts`: implements `search_api_registry`, calling the indexer + returning top matches (id, summary, confidence, example usage).
  - `describeApiFunctionTool.ts`: resolves an entry by id, returning full schema/examples plus approval guidance.
  - `invokeApiFunctionTool.ts`: orchestrates approval check, temporary key issuance, HTTP invocation, and structured result payloads.
  - `index.ts`: central export consumed by `ChatFunctionRouter` with tool metadata for the OpenAI function-calling interface.
- **Chat Integration** (`packages/product-chat/ee`):
  - `services/functionPlanner.ts`: helper invoked by the chat controller to decide when to call `search_api_registry` vs. direct execution.
  - `components/ApprovalsPanel.tsx`: renders the selected function (from `describe_api_function`) along with parameters for human approval.
- **Documentation & Playbooks** (`ee/docs/api-registry`):
  - YAML/Markdown files describing canonical tasks (e.g., `tickets.create.yaml`) referenced by registry entries.
  - Editors update these files; the build script merges their metadata into `apiRegistry.generated.ts` on demand (or during `prebuild`).
- **Testing**:
  - Unit tests in `ee/server/src/chat/tools/__tests__` validating registry search, description payloads, and invocation guardrails.
  - Integration harness in `packages/product-chat/ee/test` simulating chat flows with mocked registry + approvals.

### Registry Generation Pipeline
1. **Source Spec**: Use `sdk/scripts/generate-openapi.ts` (already part of the build) to refresh `sdk/docs/openapi/alga-openapi.ee.json`. Runtime fallback: GET `/api/v1/meta/openapi`.
2. **Extraction Script**: `ee/scripts/generate-chat-registry.ts` loads the spec, filters for operations flagged with `x-chat-callable: true` (added via OpenAPI registry decorators), normalizes method/path into stable ids, and captures request/response schemas.
3. **Metadata Merge**: For each id, merge override data from `ee/docs/api-registry/*.yaml` (playbooks, curated examples, RBAC hints, approval notes). Emit warnings for stale overrides or missing spec entries.
4. **Output Artifacts**: Write `ee/server/src/chat/registry/apiRegistry.generated.ts` (exporting an array) and optional search index JSON under `ee/server/src/chat/registry/cache/`.
5. **Build Integration**: Add npm script `pnpm --filter product-chat-ee generate-chat-registry` invoked during `dev` and `build` to keep artifacts in sync. Ensure CI runs the generator and fails on drift.
6. **Spec Annotations**: Update OpenAPI registry decorators (via `server/src/lib/api/openapi/registry.ts`) to mark eligible endpoints with `x-chat-callable`, `x-chat-display-name`, and `x-chat-rbac-resource` so the extractor has structured inputs.

## Decisions & Notes
- Function calling becomes the default path—no legacy/non-function-call model support required.
- Function execution is deferred until explicit user approval; denied requests short-circuit without issuing credentials.
- Telemetry relies on existing OpenTelemetry/PostHog pipelines; no new collectors are needed beyond event tagging.
- Temporary AI keys use a rolling 30-minute TTL and are reissued on demand if absent/expired to follow the user’s session.
- Endpoint access remains governed by the user’s RBAC permissions; no additional allowlist layer is required.

## Rollout Plan
- Land server + client changes behind an environment flag.
- Verify in staging with representative conversations.
- Enable in production for internal users before broad rollout.
