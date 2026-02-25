# Scratchpad — Vertex Preserved Thinking Chat Provider

- Plan slug: `vertex-preserved-thinking-chat-provider`
- Created: `2026-02-25`

## What This Is
Working notes for implementing a new chat provider abstraction with Vertex GLM-5 preserved thinking, while restoring streaming function-calling behavior in Sidebar Chat and Quick Ask.

## Decisions
- (2026-02-25) Create a new standalone plan folder for this effort; do not reuse prior AI streaming/function-calling plan folders.
- (2026-02-25) Keep rollout default provider as OpenRouter; Vertex is opt-in via env/secret config.
- (2026-02-25) Preserve thinking using explicit `reasoning_content` semantics in conversation state for Vertex turns.
- (2026-02-25) Keep function execution approval model unchanged (`function_proposed` -> approve/decline -> `/api/chat/v1/execute`).
- (2026-02-25) Keep `tool_choice: "auto"` for both providers to support multi-step reasoning + tool orchestration.
- (2026-02-25) No DB schema migration in scope; rely on existing chat persistence paths.
- (2026-02-25) Provider resolution will live in a dedicated `chatProviderResolver` service returning `{ providerId, model, client, requestOverrides }` so completion and stream paths share the same provider contract.

## Discoveries / Constraints
- (2026-02-25) Current streaming route emits content token deltas only; it does not surface function proposal semantics to client state.
- (2026-02-25) Sidebar Chat and Quick Ask both route through the same `Chat.tsx` behavior, so streaming/function-call fixes should land once in shared chat flow.
- (2026-02-25) Existing function execution logic is already implemented in `ChatCompletionsService`; the missing piece is stream-time function proposal propagation.
- (2026-02-25) Provider wiring is currently OpenRouter-specific in chat completions service and needs an abstraction boundary.
- (2026-02-25) `parseAssistantContent` already supports structured reasoning extraction and can consume `reasoning_content` with a fallback chain when service extraction prefers it.

## Commands / Runbooks
- (2026-02-25) Verify rollback before planning:
  - `git status --short`
- (2026-02-25) Scaffold plan folder:
  - `python3 /Users/roberisaacs/.codex/skills/alga-plan/scripts/scaffold_plan.py "Vertex Preserved Thinking Chat Provider" --slug vertex-preserved-thinking-chat-provider`
- (2026-02-25) Validate artifacts during drafting:
  - `cat ee/docs/plans/2026-02-25-vertex-preserved-thinking-chat-provider/features.json | jq .`
  - `cat ee/docs/plans/2026-02-25-vertex-preserved-thinking-chat-provider/tests.json | jq .`
- (2026-02-25) Feature validation for provider resolver wiring:
  - `cd server && npx vitest src/test/unit/services/chatCompletionsService.streaming.test.ts --run`
- (2026-02-25) Structured streaming validation:
  - `cd server && npx vitest src/test/unit/readAssistantContentFromSse.test.ts src/test/unit/api/chatCompletionsStream.route.exists.test.ts src/test/unit/Chat.streamingIncrementalState.test.tsx --run`
  - `cd server && npx vitest src/test/unit/QuickAskOverlay.streaming.test.tsx src/test/unit/RightSidebar.streaming.test.tsx --run`

## Links / References
- Chat UI shared flow:
  - `ee/server/src/components/chat/Chat.tsx`
  - `ee/server/src/components/chat/QuickAskOverlay.tsx`
  - `ee/server/src/components/layout/RightSidebarContent.tsx`
- Chat orchestration/service:
  - `ee/server/src/services/chatCompletionsService.ts`
  - `ee/server/src/services/chatProviderResolver.ts`
- Stream route:
  - `server/src/app/api/chat/v1/completions/stream/route.ts`
- Execute route:
  - `server/src/app/api/chat/v1/execute/route.ts`

## Open Questions
- How should Google access token refresh be handled operationally for Vertex (external token injection vs in-process service-account exchange)?
- Should reasoning output be user-visible by default or collapsed/hidden by default?
- Should turn-level thinking control be purely env-driven in phase 1, or request-level from server heuristics?

## Change Log
- (2026-02-25) Rolled back all in-progress implementation changes at user request.
- (2026-02-25) Created this ALGA plan (`PRD.md`, `features.json`, `tests.json`, `SCRATCHPAD.md`) for implementation-first follow-up.
- (2026-02-25) Implemented `F001`: added `chatProviderResolver` abstraction and switched chat completion + streaming model calls to resolve provider/model/client/request overrides through it.
- (2026-02-25) Implemented `F002`: provider normalization now safely falls back to `openrouter` for missing/invalid `AI_CHAT_PROVIDER`.
- (2026-02-25) Implemented `F003`: OpenRouter provider resolution now reads `OPENROUTER_API_KEY` and `OPENROUTER_CHAT_MODEL` from secret provider first, with env fallback.
- (2026-02-25) Implemented `F004`: Vertex provider resolution now reads `GOOGLE_CLOUD_ACCESS_TOKEN`, `VERTEX_CHAT_MODEL`, and endpoint settings from secrets/env and returns an OpenAI-compatible client.
- (2026-02-25) Implemented `F005`: Vertex resolver now prefers explicit `VERTEX_OPENAPI_BASE_URL` and falls back to derived project/location endpoint synthesis.
- (2026-02-25) Implemented `F006`: provider request overrides now expose Vertex turn-level thinking disable payload (`extra_body.thinking.enabled=false`) driven by `VERTEX_ENABLE_THINKING` or explicit per-turn override.
- (2026-02-25) Implemented `F007`: added optional `reasoning_content` to shared chat message contracts in EE chat client + server chat completion service types.
- (2026-02-25) Implemented `F008`: completion/execute and streaming request validators now accept `reasoning_content` and reject malformed non-string values.
- (2026-02-25) Implemented `F009`: `reasoning_content` is preserved through conversation normalization and injected into Vertex assistant message payloads during OpenAI-compatible conversion.
- (2026-02-25) Implemented `F010`: non-stream completion calls now resolve provider/model/client from `chatProviderResolver` rather than hardcoded OpenRouter config.
- (2026-02-25) Implemented `F011`: streaming completion creation now resolves provider/model/client from `chatProviderResolver` instead of direct OpenRouter client construction.
- (2026-02-25) Implemented `F012`: both providers now share the same tool definitions and preserve `tool_choice: \"auto\"` in request construction.
- (2026-02-25) Implemented `F013`: assistant response parsing now prioritizes `reasoning_content` with `reasoning` as fallback to preserve compatibility across Vertex + OpenRouter payload shapes.
- (2026-02-25) Implemented `F014`: assistant messages appended during tool-call iterations now include preserved `reasoning_content` in in-memory conversation state.
- (2026-02-25) Implemented `F015`: `function_proposed` responses now return conversation snapshots (`nextMessages`/`modelMessages`) that carry preserved `reasoning_content`.
- (2026-02-25) Implemented `F016`: execute-after-approval continuation now reuses validated prior messages (including `reasoning_content`) before replaying tool results and requesting follow-up completion.
- (2026-02-25) Implemented `F017`: replaced token-only stream route behavior with structured event orchestration (`content_delta`, `reasoning_delta`, `function_proposed`, `done`) via a new `ChatCompletionsService.createStructuredCompletionStream` loop.
- (2026-02-25) Implemented `F018`: stream route now emits explicit `content_delta` SSE events while keeping legacy `{content, done:false}` compatibility fields.
- (2026-02-25) Implemented `F019`: stream route now emits explicit `reasoning_delta` SSE events sourced from provider reasoning delta fields.
- (2026-02-25) Implemented `F020`: structured streaming now emits `function_proposed` events with function metadata + continuation conversation state when the model selects `call_api_endpoint`.
- (2026-02-25) Implemented `F021`: stream route now emits terminal `done` events consistently (with legacy `{content:'', done:true}` compatibility fields).
- (2026-02-25) Implemented `F022`: route + SSE reader + Chat flow now stop cleanly on abort/cancel (including function-proposal short-circuit) without falsely persisting a completed assistant message.
- (2026-02-25) Implemented `F023`: `readAssistantContentFromSse` now parses structured event types for content deltas, reasoning deltas, function proposals, and done markers while tolerating malformed lines.
- (2026-02-25) Implemented `F024`: Chat streaming flow now consumes structured reasoning/content deltas and updates in-progress reasoning state while rendering streamed content.
- (2026-02-25) Implemented `F025`: Chat now captures streamed `function_proposed` events into `pendingFunction` state and halts stream token collection to enter approval mode.
- (2026-02-25) Implemented `F026`: streamed proposal metadata (`functionCall`, `nextMessages`) now feeds unchanged approve/decline posts to `/api/chat/v1/execute`.
- (2026-02-25) Implemented `F027`: Quick Ask inherits restored streaming function-calling behavior through the shared `Chat` component stream consumer path.
- (2026-02-25) Implemented `F028`: Right Sidebar chat inherits restored streaming function-calling behavior through the shared `Chat` component stream consumer path.
- (2026-02-25) Implemented `F029`: stream payloads remain backward-compatible by preserving legacy `content`/`done` fields alongside structured event typing.
- (2026-02-25) Implemented `F030`: kept existing EE + `aiAssistant` gating checks unchanged for completions, execute, and stream routes.
- (2026-02-25) Implemented `F031`: documented AI chat provider env contract in root `.env.example` and `ee/server/.env.example` for OpenRouter + Vertex configuration.
- (2026-02-25) Implemented `F032`: preserved existing chat persistence flow with no schema/migration changes while adding structured streaming + function proposal handling.
- (2026-02-25) Implemented `T001`: added provider resolver unit coverage verifying default fallback to `openrouter` when `AI_CHAT_PROVIDER` is unset.
- (2026-02-25) Implemented `T002`: verified resolver returns configured OpenRouter client/model when OpenRouter settings are present.
- (2026-02-25) Implemented `T003`: verified resolver returns Vertex client/model when `AI_CHAT_PROVIDER=vertex` with required config.
- (2026-02-25) Implemented `T004`: covered explicit Vertex base URL override behavior via `VERTEX_OPENAPI_BASE_URL`.
- (2026-02-25) Implemented `T005`: covered Vertex derived endpoint synthesis from `VERTEX_PROJECT_ID` + `VERTEX_LOCATION`.
- (2026-02-25) Implemented `T006`: added resolver error-path coverage when Vertex access token configuration is missing.
- (2026-02-25) Implemented `T007`: covered Vertex thinking override default/true paths where no disable payload is emitted.
- (2026-02-25) Implemented `T008`: covered Vertex turn-level thinking disable payload when `VERTEX_ENABLE_THINKING=false`.
- (2026-02-25) Implemented `T009`: verified OpenRouter provider overrides never include Vertex-specific thinking payload.
- (2026-02-25) Implemented `T010`: added unit coverage in `chatCompletionsService.unit.test.ts` proving completion validation accepts assistant `reasoning_content` strings.
- (2026-02-25) Implemented `T011`: added unit coverage in `chatCompletionsService.unit.test.ts` rejecting invalid non-string `reasoning_content` values during completion validation.
- (2026-02-25) Implemented `T012`: covered conversation normalization preserving assistant `reasoning_content` values end-to-end in completion preprocessing.
- (2026-02-25) Implemented `T013`: added sanitization coverage confirming client-facing assistant content retains `reasoning_content` needed for function-call continuation context.
- (2026-02-25) Implemented `T014`: added provider message builder assertions confirming Vertex assistant payload conversion includes preserved `reasoning_content` during tool-loop replay.
- (2026-02-25) Implemented `T015`: added OpenRouter conversion coverage ensuring assistant payloads remain compatible without forwarding `reasoning_content` fields.
- (2026-02-25) Implemented `T016`: verified reasoning extraction falls back to legacy `<think>` blocks when explicit `reasoning_content` is unavailable.
- (2026-02-25) Implemented `T017`: response parsing coverage now asserts `reasoning_content` is preferred over fallback `reasoning` when both are present.
- (2026-02-25) Implemented `T018`: response parsing coverage includes fallback to `reasoning` when `reasoning_content` is absent.
- (2026-02-25) Implemented `T019`: added tool-turn assertions proving assistant messages appended during function proposal include preserved `reasoning_content`.
- (2026-02-25) Implemented `T020`: added final-response assertions ensuring non-tool assistant messages still carry preserved `reasoning_content`.
- (2026-02-25) Implemented `T021`: added non-stream completion coverage asserting OpenRouter requests use provider-resolved client/model wiring.
- (2026-02-25) Implemented `T022`: added non-stream completion coverage asserting Vertex requests use provider-resolved client/model wiring.
- (2026-02-25) Implemented `T023`: completion request tests now assert `tool_choice: "auto"` is preserved for both OpenRouter and Vertex providers.
- (2026-02-25) Implemented `T024`: added assertions that `function_proposed` responses include `nextMessages` and `modelMessages` with preserved reasoning context.
- (2026-02-25) Implemented `T025`: execute-after-approval unit coverage now verifies continuation requests replay preserved assistant context plus tool result before follow-up completion.
- (2026-02-25) Implemented `T026`: decline-path unit coverage verifies endpoint execution is skipped while continuation messaging remains consistent and usable.
- (2026-02-25) Implemented `T027`: added explicit `handleExecute` guard test returning 400 when function call metadata is missing.
- (2026-02-25) Implemented `T028`: added assertions that tool call IDs remain stable from proposal through tool-result replay in execute continuation flow.
- (2026-02-25) Implemented `T029`: stream route events test now validates assistant `reasoning_content` is accepted in request payload schema.
- (2026-02-25) Implemented `T030`: expanded stream route event coverage with explicit assertions for typed `content_delta` SSE payload emission (including compatibility `content`/`done:false` fields).
- (2026-02-25) Implemented `T031`: stream route events test asserts typed `reasoning_delta` SSE payloads are emitted from provider reasoning chunks.
- (2026-02-25) Implemented `T032`: stream route coverage now validates `function_proposed` SSE emission with stable function-call metadata when tools are selected.
- (2026-02-25) Implemented `T033`: stream route events test now asserts a terminal typed `done` SSE payload is emitted on successful completion.
- (2026-02-25) Implemented `T034`: stream route event tests cover abort handling and verify no post-abort chunks are emitted.
- (2026-02-25) Implemented `T035`: stream route coverage asserts malformed message payloads return HTTP 400 and never invoke the completion stream service.
- (2026-02-25) Implemented `T036`: stream endpoint tests keep `aiAssistant` feature-gating semantics by asserting the existing 403 response path.
- (2026-02-25) Implemented `T037`: stream endpoint tests preserve EE gating behavior by asserting CE deployments still return the prior 404 contract.
- (2026-02-25) Implemented `T038`: SSE reader tests now assert structured `content_delta` chunks accumulate correctly and emit incremental token callbacks.
- (2026-02-25) Implemented `T039`: SSE reader coverage verifies `onReasoning` callback invocation and accumulation for streamed `reasoning_delta` events.
- (2026-02-25) Implemented `T040`: SSE reader tests assert `onToolCalls` receives structured `function_proposed` payloads with tool-call metadata.
- (2026-02-25) Implemented `T041`: SSE reader tests verify typed `done` events terminate parsing and return `doneReceived=true`.
- (2026-02-25) Implemented `T042`: SSE reader tests confirm malformed JSON lines are ignored without crashing stream consumption.
- (2026-02-25) Implemented `T043`: SSE reader tests ensure `shouldContinue=false` cancels the underlying reader and exits early.
- (2026-02-25) Implemented `T044`: Chat streaming UI tests verify in-progress reasoning state updates as `reasoning_delta` events arrive.
- (2026-02-25) Implemented `T045`: Chat stream tests now assert pending function state is populated from streamed `function_proposed` events.
- (2026-02-25) Implemented `T046`: Chat approve-path tests verify `/api/chat/v1/execute` receives streamed `functionCall` metadata unchanged.
- (2026-02-25) Implemented `T047`: Chat decline-path tests verify `/api/chat/v1/execute` posts `action=decline` while preserving usable conversation state.
- (2026-02-25) Implemented `T048`: Chat streaming tests cover stop/abort/interruption behavior and assert failed execute flows do not persist false completed assistant messages.
- (2026-02-25) Implemented `T049`: Quick Ask expanded chat tests now cover streamed function proposal handling through approve→execute continuation.
- (2026-02-25) Implemented `T050`: expanded `RightSidebar.streaming.test.tsx` to cover streamed function proposal approval and `/api/chat/v1/execute` continuation wiring, plus test isolation cleanup hooks.
- (2026-02-25) Implemented `T051`: added `chatPersistenceExecution.integration.test.ts` DB-backed happy-path coverage verifying approved-execution assistant output is persisted as final bot message in chat history.
- (2026-02-25) Implemented `T052`: same DB-backed integration suite now verifies declined/failed guard behavior by asserting no false completed assistant message is persisted.
- (2026-02-25) Implemented `T053`: Chat streaming incremental tests continue to validate text-only stream rendering without tool proposals, preserving OpenRouter-compatible behavior.
- (2026-02-25) Implemented `T054`: Chat stream tests now cover combined reasoning/content deltas resolving to a final assistant response, matching Vertex-style non-tool streaming behavior.
