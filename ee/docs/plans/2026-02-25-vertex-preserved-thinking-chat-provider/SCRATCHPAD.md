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
