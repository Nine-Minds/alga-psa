# Scratchpad — Inbound Email Reopen On Reply

- Plan slug: `inbound-email-reopen-on-reply`
- Created: `2026-03-31`

## What This Is

Keep a lightweight, continuously-updated log of discoveries and decisions made while implementing this plan.

Prefer short bullets. Append new entries as you learn things, and also *update earlier notes* when a decision changes or an open question is resolved.

## Decisions

- (2026-03-31) Reopen-on-reply policy will be configured per board because ticket statuses are board-owned and reopen status selection must stay board-scoped.
- (2026-03-31) Internal-user threaded replies against closed tickets always reopen when inside the configured cutoff window.
- (2026-03-31) Client/contact threaded replies against closed tickets reopen by default, but boards can opt into AI acknowledgement suppression.
- (2026-03-31) AI suppression remains optional and visible in board settings so admins can discover and opt out of it.
- (2026-03-31) AI acknowledgement suppression is an EE enhancement gated by the `AI Assistant` add-on and isolated behind a shared interface with an EE implementation resolved manually in EE mode.
- (2026-03-31) V1 uses the standard LLM path with a minimal prompt and tiny formatted output such as `ACK` / `NOT_ACK`; optimization can happen later.
- (2026-03-31) Reopen policy persistence fields were added directly to `boards` so policy reads remain O(1) during inbound processing and configuration stays board-scoped.
- (2026-03-31) Inbound threaded reply handling now computes a per-reply decision record (policy, cutoff, sender kind, AI result, reopen target source) and stores/logs it for debugging.
- (2026-03-31) When reopen policy context cannot be loaded (unexpected DB/runtime issue), threaded reply processing continues in comment-only mode to preserve inbound resiliency.
- (2026-03-31) DB-backed integration coverage for AI suppression branches uses a mocked shared decider contract to deterministically assert inbound reopen behavior for `ACK`, `NOT_ACK`, add-on-missing, and invalid-output fallback outcomes without coupling server tests to EE runtime wiring.

## Discoveries / Constraints

- (2026-03-31) `shared/services/email/processInboundEmailInApp.ts` already matches replies by conversation token and thread headers, creates comments, and updates watch lists, but it does not currently perform inbound-specific reopen transitions for closed tickets.
- (2026-03-31) Existing helper `hasSubstantiveReplyContent(...)` is not semantic; it strips Alga reply markers and only checks whether any text remains. It currently protects token-only/self-notification cases.
- (2026-03-31) Board-owned ticket statuses already enforce exactly one open default status in settings flows, which provides a safe fallback reopen target.
- (2026-03-31) Existing ticket update paths already maintain `status_id`, `is_closed`, `closed_at`, and `closed_by` when transitioning between open and closed statuses.
- (2026-03-31) Existing EE AI entry points use edition checks plus manual `@ee/...` imports and gate execution on `AI Assistant` entitlement via `tenant_addons`.
- (2026-03-31) Shared unit tests for `processInboundEmailInApp` use narrow table mocks, so new policy reads must tolerate unavailable table access/mocks without failing the reply path.
- (2026-03-31) DB-backed integration tests in `inboundEmailInApp.webhooks.integration.test.ts` are guarded by a runtime DB reachability probe and are skipped automatically when local DB is unavailable.
- (2026-03-31) `processInboundEmailInApp` imports the shared acknowledgement decider interface, so integration tests can safely control AI suppression outcomes by mocking `@alga-psa/shared/services/email/inboundReplyAcknowledgementDecider`.

## Commands / Runbooks

- (2026-03-31) `python3 /Users/roberisaacs/.codex/skills/alga-plan/scripts/scaffold_plan.py "Inbound Email Reopen On Reply" --slug inbound-email-reopen-on-reply`
- (2026-03-31) `cd shared && npx vitest run services/email/__tests__/processInboundEmailInApp.test.ts`
- (2026-03-31) `cd server && npx vitest run src/components/settings/general/BoardsSettings.copyStatuses.test.tsx`
- (2026-03-31) `cd server && npx vitest run src/test/integration/inboundEmailInApp.webhooks.integration.test.ts -t "T001|T002|T003|T004"` (suite skipped locally due DB reachability gate)
- (2026-03-31) `cd shared && npx vitest run services/email/__tests__/inboundReplyAcknowledgementDecider.test.ts`
- (2026-03-31) `cd server && npx vitest run src/test/integration/inboundEmailInApp.webhooks.integration.test.ts -t "T006|T007|T008|T009|T012"` (suite skipped locally due DB reachability gate; file parsed and tests registered)

## Links / References

- Design note: `docs/plans/2026-03-31-inbound-email-reopen-on-reply-design.md`
- Plan folder: `ee/docs/plans/2026-03-31-inbound-email-reopen-on-reply/`
- Inbound reply orchestration: `shared/services/email/processInboundEmailInApp.ts`
- Email workflow helpers: `shared/workflow/actions/emailWorkflowActions.ts`
- Ticket default status fallback: `shared/models/ticketModel.ts`
- Ticket status transition semantics: `packages/tickets/src/actions/ticketActions.ts`, `server/src/lib/api/services/TicketService.ts`
- AI add-on gating: `server/src/lib/tier-gating/getActiveAddOns.ts`, `server/src/lib/tier-gating/assertAddOnAccess.ts`
- EE chat provider resolution: `ee/server/src/services/chatProviderResolver.ts`
- Shared ACK decider interface: `shared/services/email/inboundReplyAcknowledgementDecider.ts`
- EE ACK decider implementation: `packages/ee/src/services/email/inboundReplyAcknowledgementDecider.ts`

## Open Questions

- No blocking questions after design approval. Possible later follow-up: whether cutoff expiry should create a new ticket from the current matched reply path or require a small shared helper refactor to avoid duplicate logic.
