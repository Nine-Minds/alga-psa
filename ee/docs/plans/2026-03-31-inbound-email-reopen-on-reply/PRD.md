# PRD — Inbound Email Reopen On Reply

- Slug: `inbound-email-reopen-on-reply`
- Date: `2026-03-31`
- Status: Draft

## Summary

Add per-board inbound-email reopen policies for replies against closed tickets. Match ConnectWise-style behavior by allowing boards to opt into reopen-on-reply, configure a cutoff window, and choose a reopen status. Add optional Enterprise Edition AI suppression for short client acknowledgements when the tenant has the `AI Assistant` add-on.

## Problem

Inbound email threading already finds existing tickets and appends comments, but replies against closed tickets do not have a clear lifecycle policy. This creates ambiguity for technicians and customers, especially when a legitimate follow-up should resume work but a trivial "thanks" should not reopen a finished ticket.

## Goals

- Reopen closed tickets automatically for valid inbound replies using board-scoped policy.
- Support a configurable cutoff window so old replies create a new ticket instead of reviving stale work.
- Let boards configure an explicit reopen status while falling back to the board's default open status.
- Always reopen for internal-user email replies.
- Optionally suppress reopen for short client acknowledgements using the standard LLM path when EE + `AI Assistant` are available.
- Keep inbound processing resilient and non-blocking when AI or configuration is unavailable.

## Non-goals

- Building a general-purpose AI classifier infrastructure.
- Restoring the exact historical pre-closure status.
- Making reopen policy provider-scoped or tenant-wide.
- Adding new workflow automation surfaces for this v1.
- Building advanced analytics or reporting for reopen decisions.

## Users and Primary Flows

- MSP technicians:
  - Need closed tickets to reopen automatically when internal discussion or new customer work resumes.
  - Need stale replies to become new work instead of mutating old tickets.
- MSP admins:
  - Need board-specific control over reopen policy, cutoff, reopen status, and AI suppression opt-out.
- Client contacts:
  - Their substantive replies should reopen active work.
  - Their simple acknowledgements should optionally remain attached without reopening when the board enables AI suppression.

Primary flows:

1. Internal user replies by email to a closed ticket within cutoff -> ticket reopens -> reply comment is added.
2. Client replies by email to a closed ticket within cutoff -> ticket reopens unless AI suppression classifies the reply as a simple acknowledgement.
3. Any threaded reply to a closed ticket after cutoff -> old ticket remains closed -> inbound flow creates a new ticket.

## UX / UI Notes

- Add reopen policy controls to board settings because ticket statuses are board-owned.
- Expose AI acknowledgement suppression as a visible board option so admins know the feature exists and can opt out.
- Reopen status picker should use board-owned ticket statuses.
- If AI suppression is unavailable because the tenant lacks `AI Assistant`, the setting should either be disabled with explanatory copy or treated as inactive at runtime.

## Requirements

### Functional Requirements

- Board settings must persist reopen-on-inbound-reply configuration:
  - enable/disable
  - cutoff duration
  - optional reopen status
  - AI acknowledgement suppression enable/disable
- When inbound threading matches an existing closed ticket:
  - if reopen is disabled, attach the comment without reopening
  - if reply age exceeds cutoff, route into new-ticket creation instead of attaching to the closed ticket
  - if sender is internal, reopen
  - if sender is client/contact, reopen unless AI suppression is enabled and returns `ACK`
- Reopen must update `status_id`, `is_closed`, `closed_at`, and `closed_by` consistently with existing ticket status transition semantics.
- If no explicit reopen status is configured, fallback must use the board's default open status.
- Existing dedupe and token-only self-notification guards must remain intact.
- The AI acknowledgement decision path must be isolated behind a shared interface with an EE implementation injected in EE mode.
- The EE implementation must only call AI when:
  - board AI suppression is enabled
  - tenant has `AI Assistant`
  - reply is short and plausibly acknowledgement-like
- AI prompt/output must be minimal and return a tiny formatted response such as `ACK` or `NOT_ACK`.

### Non-functional Requirements

- Inbound email processing must not fail closed because of missing AI entitlement, missing EE code, invalid AI output, or AI runtime errors.
- Fallback behavior for AI failures is reopen normally.
- Logging or stored metadata must be sufficient to explain reopen decisions during debugging.

## Data / API / Integrations

- Add board-scoped configuration fields for reopen policy and AI suppression.
- Reuse existing board-owned status selection and `TicketModel.getDefaultStatusId(...)`.
- Reuse existing inbound threading flow in `shared/services/email/processInboundEmailInApp.ts`.
- Reuse existing AI provider resolution pattern in EE code via `@ee/...`.
- AI suppression uses the existing `AI Assistant` add-on entitlement (`ai_assistant`).

## Security / Permissions

- Board reopen policy editing follows existing board-settings permissions.
- AI suppression execution must require the tenant `AI Assistant` add-on before any LLM call.
- CE environments must not import or require EE AI code paths at runtime.

## Observability

- Log or persist decision metadata for:
  - reopen enabled/disabled
  - cutoff exceeded
  - reopen target source (explicit status vs board default)
  - AI suppression attempted / skipped / failed
  - AI result (`ACK` / `NOT_ACK`)

## Rollout / Migration

- Default existing boards to reopen disabled so behavior does not change silently.
- New board settings become active only when configured by admins.
- AI suppression is dormant unless both board config and add-on entitlement are present.

## Open Questions

- None blocking design. Future optimization work may replace the standard LLM call with a narrower classifier or heuristic layer once production examples are available.

## Acceptance Criteria (Definition of Done)

- Boards can configure reopen-on-inbound-reply behavior, cutoff window, optional reopen status, and AI suppression.
- Closed-ticket inbound replies follow the configured policy for internal and client senders.
- Replies beyond cutoff create new tickets instead of reopening stale ones.
- AI suppression only runs in EE with `AI Assistant` entitlement and falls back safely on any failure.
- Behavioral integration coverage proves reopen, no-reopen, cutoff, and fallback outcomes.
