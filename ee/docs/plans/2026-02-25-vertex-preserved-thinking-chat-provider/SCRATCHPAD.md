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
