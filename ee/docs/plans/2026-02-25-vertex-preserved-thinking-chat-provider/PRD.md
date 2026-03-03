# PRD — Vertex Preserved Thinking Chat Provider

- Slug: `vertex-preserved-thinking-chat-provider`
- Date: `2026-02-25`
- Status: Draft

## Summary
Implement a provider abstraction for AI chat so Enterprise chat can run on either OpenRouter (current default) or Vertex AI OpenAI-compatible Chat Completions, with first-class support for GLM-5 (`glm-5-maas`) preserved thinking (`reasoning_content`), tool calling, and streaming in one continuous loop.

This work must also fix the current behavioral gap where chat/quick ask streaming does not trigger function calls.

## Problem
Current chat behavior has three core issues:

1. Streaming path drops tool/function semantics:
- Chat and Quick Ask use `/api/chat/v1/completions/stream`.
- The stream route forwards text token deltas only.
- Function/tool proposals are never surfaced, so function execution cannot start.

2. Provider implementation is hardcoded:
- Chat completions are tied to OpenRouter-specific client/model resolution.
- There is no runtime provider selection for Vertex.

3. Preserved thinking is not an explicit contract:
- Multi-step tool loops need assistant reasoning carried across turns.
- For Vertex GLM-5 interleaved thinking, this must include `reasoning_content` continuity.

## Goals
1. Add a runtime-selectable chat provider abstraction supporting:
- `openrouter` (default)
- `vertex` (OpenAI-compatible endpoint)

2. Enable Vertex GLM-5 (`glm-5-maas`) for chat completions and streaming.

3. Preserve assistant thinking across tool boundaries using `reasoning_content` semantics when provider is Vertex.

4. Restore function-calling behavior in streaming chat and quick ask.

5. Keep existing approval/decline workflow and temporary API-key execution model.

6. Keep `tool_choice: "auto"` for interleaved tool reasoning.

## Non-goals
1. Migrating non-chat AI surfaces to Vertex.
2. Replacing API registry or function execution authorization model.
3. Building a tenant UI for provider selection.
4. Adding new database tables for reasoning persistence.
5. Large observability/analytics redesign.

## Users and Primary Flows
- Primary user: Enterprise end user using Sidebar Chat or Quick Ask.
- Primary admin/operator: Environment maintainer configuring provider env vars/secrets.

Flow A: Streaming function call with preserved thinking
1. User asks for an action requiring API execution.
2. Assistant streams reasoning tokens.
3. Assistant streams/proposes a tool call.
4. User approves.
5. Tool executes.
6. Assistant resumes with preserved reasoning + tool result and streams final answer.

Flow B: OpenRouter compatibility
1. Provider remains `openrouter`.
2. Existing behavior remains functional.
3. Streaming and function approval flow still work.

Flow C: Vertex thinking control
1. Provider is `vertex`.
2. Turn-level thinking can be disabled for specific turns by server-side request shaping when needed.

## UX / UI Notes
1. Sidebar Chat and Quick Ask must behave identically for function calling.
2. Streaming should support both:
- reasoning stream updates
- user-facing content stream updates
3. Function approval card remains the decision point before executing any endpoint.
4. Interrupted streams must preserve partial output state and avoid false “completed” persistence.
5. Thinking display may remain collapsible; reasoning and answer channels should be distinct in state even if rendered together initially.

## Requirements
### Functional Requirements
1. Add provider resolver that returns provider id, model, OpenAI-compatible client, and provider-specific request overrides.
2. Add Vertex configuration support:
- model default `glm-5-maas`
- endpoint base URL from explicit setting or project/location synthesis
- auth via Google Cloud access token secret/env
3. Extend chat message contract to include optional `reasoning_content`.
4. Preserve reasoning data through:
- request validation
- conversation normalization
- provider message conversion
- tool replay turns
5. Replace token-only streaming behavior with orchestrated streaming events that can represent:
- reasoning deltas
- content deltas
- function proposal events
- completion event
6. Ensure streamed function proposal reaches client `pendingFunction` state, enabling `/api/chat/v1/execute`.
7. Ensure execute path sends preserved assistant state + tool result back to provider before continuation completion.
8. Keep OpenRouter behavior functional and backward-compatible.
9. Keep chat API gating (`aiAssistant` + EE checks) unchanged.
10. Keep `tool_choice: "auto"` for OpenRouter and Vertex.
11. Support server-driven turn-level thinking disable for Vertex when requested.
12. Document provider env/secrets contract in env examples.

### Non-functional Requirements
1. No database migration required.
2. Provider selection defaults safely to OpenRouter when unspecified.
3. Streaming parser should tolerate unknown SSE event fields.
4. Maintain current security posture for function execution (approval + temporary API key).

## Data / API / Integrations
1. New provider config inputs:
- `AI_CHAT_PROVIDER` (`openrouter` | `vertex`)
- OpenRouter: `OPENROUTER_API_KEY`, `OPENROUTER_CHAT_MODEL`
- Vertex: `GOOGLE_CLOUD_ACCESS_TOKEN` (or equivalent secret), `VERTEX_PROJECT_ID`, `VERTEX_LOCATION`, `VERTEX_CHAT_MODEL`, optional `VERTEX_OPENAPI_BASE_URL`, optional thinking toggle

2. Chat message model (server/client)
- Add optional `reasoning_content` on assistant messages.

3. Streaming event model
- SSE events must carry typed payloads for reasoning, content, function proposals, and done.

4. Vertex request shaping
- Use OpenAI-compatible chat completions endpoint.
- Include `reasoning_content` on assistant turns when available.
- Allow turn-level thinking override payload when configured.

5. Existing execution model
- Keep API registry search + `call_api_endpoint` + approval handshake.

## Security / Permissions
1. No change to permission boundaries for endpoint execution.
2. No bypass of manual approval for approval-required calls.
3. Continue issuing and revoking temporary API keys for approved execution.
4. Provider credentials must resolve via secret provider/env; never serialized to client.

## Observability
1. Keep existing logs, add provider id in completion/stream logs for debugging.
2. No new observability system work in this scope.

## Rollout / Migration
1. Deploy with default provider = OpenRouter.
2. Enable Vertex by environment configuration only.
3. Roll out Vertex first in non-production environments.
4. Keep immediate fallback: revert provider env to OpenRouter.

## Open Questions
1. Token source lifecycle: should Vertex OAuth access token be externally refreshed and injected, or should server mint tokens from service account credentials in-process?
2. Thinking visibility policy: should reasoning UI be visible by default or hidden by default for end users?
3. Turn-level thinking control source: env-only for now, or request-level heuristic toggle from server logic?

## Acceptance Criteria (Definition of Done)
1. With provider `openrouter`, chat and quick ask can again propose functions during streaming and execute approved calls end-to-end.
2. With provider `vertex`, chat and quick ask can stream reasoning + content, propose functions, execute approved calls, and continue with preserved reasoning context.
3. `reasoning_content` survives assistant -> tool -> assistant loops for Vertex without being dropped.
4. `/api/chat/v1/completions/stream` emits structured events sufficient for UI function proposal and continuation flow.
5. Existing `/api/chat/v1/execute` approval model remains intact.
6. No database migration required; existing message persistence remains functional.
7. Provider env configuration is documented in `.env.example` and `ee/server/.env.example`.
8. Test suite additions cover provider selection, Vertex request shape, streaming event parsing, function proposal path, and at least one DB-backed happy path plus one DB-backed guard/failure path.
