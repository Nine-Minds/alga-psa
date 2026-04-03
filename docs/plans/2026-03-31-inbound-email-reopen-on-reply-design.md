# Inbound Email Reopen On Reply Design

- Date: `2026-03-31`
- Status: `Approved`

## Summary

Improve inbound email threading against closed tickets by adding ConnectWise-style reopen behavior with per-board configuration, a configurable cutoff window, and optional AI suppression for simple client acknowledgements. Reopen-on-reply remains core behavior; AI suppression is an Enterprise Edition enhancement gated by the `AI Assistant` add-on.

## Current State

Inbound replies are matched in [`shared/services/email/processInboundEmailInApp.ts`](../../shared/services/email/processInboundEmailInApp.ts) via reply token or thread headers and then appended as comments. The matched-ticket reply path does not currently perform any inbound-specific reopen transition for closed tickets.

Ticket statuses are board-owned. Boards already have exactly one open default status, and existing ticket update paths already align `status_id`, `is_closed`, `closed_at`, and `closed_by` when moving between open and closed statuses.

The current inbound heuristic only filters token-only or effectively empty replies by stripping Alga reply markers and checking whether any text remains.

## Product Decisions

- Reopen behavior is configured per board.
- Internal user replies always reopen closed tickets when threading matches and the cutoff window has not expired.
- Client/contact replies reopen closed tickets when threading matches and the cutoff window has not expired, unless AI suppression is enabled and classifies the reply as a simple acknowledgement.
- Boards may define an explicit `reopen_status_id`.
- If `reopen_status_id` is unset, reopening falls back to the board's default open status.
- Boards define a configurable cutoff window. Replies beyond that window do not revive the old ticket and instead enter the new-ticket path.
- AI acknowledgement suppression is a configurable board option so users can discover and opt out of it.

## Board Configuration

Each board gains reopen-on-reply policy fields:

- `reopen_on_inbound_reply_enabled`
- `reopen_cutoff_minutes` or equivalent duration field
- `reopen_status_id` nullable
- `ai_ack_suppression_enabled`

These settings belong to boards rather than providers because reopen semantics and status ownership are board-scoped.

## Runtime Decision Flow

When inbound email matches an existing ticket:

1. Load the matched ticket, board, and current status.
2. If the ticket is not closed, keep current behavior.
3. If the ticket is closed and the board policy disables reopen-on-reply, add the comment without reopening.
4. If the ticket is closed and the cutoff window is exceeded, do not attach to the old ticket; route into the existing new-ticket path.
5. If the sender is internal, reopen immediately.
6. If the sender is a client/contact:
   - Run the existing cheap heuristic first.
   - If AI suppression is disabled, or the tenant lacks `AI Assistant`, or the reply is clearly substantive, reopen normally.
   - If AI suppression is enabled and the reply is short and plausibly acknowledgement-like, call the standard LLM path with a tightly constrained prompt and require a tiny formatted response such as `ACK` or `NOT_ACK`.
   - `ACK` keeps the ticket closed and still records the comment.
   - `NOT_ACK` reopens normally.
7. Reopen by updating `status_id`, `is_closed`, `closed_at`, and `closed_by` using the same transition semantics used in existing ticket update paths.

## AI Architecture

Reopen-on-reply is core behavior, but AI suppression is an EE enhancement and should follow the existing CE/EE split:

- Shared/server code depends on a small pluggable interface, for example `InboundReplyAcknowledgementDecider`.
- The default CE implementation performs no semantic suppression and always returns "not acknowledgement".
- In EE mode, shared/server code manually resolves an EE implementation from `@ee/...`.
- The EE implementation may call the standard chat-completions provider already used elsewhere in the product.
- The EE implementation must still require the `AI Assistant` add-on and the board-level `ai_ack_suppression_enabled` flag before issuing any LLM call.
- If EE code is unavailable, entitlement fails, or the LLM call errors, the system falls back to normal reopen behavior.

This keeps AI-specific prompt and model behavior isolated in EE code while leaving the core reopen flow shared.

## Failure Behavior

- If no valid reopen target can be resolved, attach the comment without reopening and log the configuration issue.
- If AI suppression cannot run for any reason, reopen normally rather than blocking email processing.
- Existing dedupe must continue to run before reopen/comment work so duplicate deliveries do not cause repeated reopen transitions.
- The system should record decision metadata sufficient to explain outcomes later, such as reopen reason, cutoff result, and AI suppression result.

## Test Coverage

Prefer behavioral integration coverage around the inbound email flow:

- Closed ticket + internal reply reopens to explicit reopen status.
- Closed ticket + internal reply without explicit reopen status reopens to board default open status.
- Closed ticket + client reply with AI suppression disabled reopens.
- Closed ticket + client reply with AI suppression enabled and `ACK` stays closed while adding the comment.
- Closed ticket + client reply with AI suppression enabled and `NOT_ACK` reopens.
- Closed ticket + client reply with AI enabled but no `AI Assistant` add-on reopens without AI.
- Closed ticket + AI failure reopens without AI.
- Closed ticket + reply beyond cutoff creates a new ticket instead of attaching to the closed one.
- Open ticket replies preserve current behavior.
- Token-only replies remain skipped by the existing heuristic.
