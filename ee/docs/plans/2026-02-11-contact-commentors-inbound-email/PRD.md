# PRD — Ticket Contact Commentors + Inbound Email Contact Authorship

- Slug: `contact-commentors-inbound-email`
- Date: `2026-02-11`
- Status: Draft

## Summary

Add first-class support for ticket comments authored by a `contact` that does not have a `users` record.  
For inbound email processing, when sender email matches a contact, create/attach comments as that contact instead of falling back to unknown-user display.

This work has two connected scopes:

1. Ticket comments: represent and render contact-authored comments without requiring a client-portal user record.
2. Inbound email: use the contact-authorship capability in new-ticket and reply flows.

## Problem

Today, ticket comment display logic is user-centric:

- `comments.user_id` is the primary identity used by ticket detail UIs.
- Conversation rendering builds `userMap` only from `users`.
- Contact-authored comments without `user_id` are rendered as `Unknown User`.

Inbound email processing can already match a sender to a contact, but if that contact has no linked client user, comment identity is incomplete in the UI and APIs.

## Goals

- Support ticket comments authored by contacts who are not users.
- Persist explicit contact authorship linkage on comments.
- Render contact identity (name/avatar/email, with clear contact semantics) in ticket conversation UI.
- Ensure inbound email flows write comments with contact authorship when sender matches a contact.
- Keep existing behavior for internal comments and client-user-authored comments intact.
- Keep response-state behavior intact (`client/contact` replies still move ticket to `awaiting_internal`).

## Non-goals

- Creating or inviting client-portal users automatically for unmatched contacts.
- Redesigning ticket conversation UX beyond author identity display.
- Reworking mention systems, permissions model, or comment edit/delete policy.
- Adding ticket-list/table filtering for contact-authored comments.
- Full historical backfill of legacy unknown comments in this phase.

## Users and Primary Flows

### Flow A — New inbound email from known contact (no user)

1. System receives inbound email for configured mailbox.
2. Sender email matches an existing contact with no linked `users` row.
3. Ticket is created (or routed as configured).
4. Initial comment is stored with contact authorship.
5. Ticket UI shows contact identity instead of `Unknown User`.

### Flow B — Reply inbound email on existing ticket from known contact (no user)

1. System resolves ticket by reply token/thread headers.
2. Sender email matches contact without user.
3. Reply comment is appended with contact authorship.
4. Ticket UI shows contact author and response state updates as client-side reply.

### Flow C — Contact has linked client user

1. Existing matched client-user behavior remains valid.
2. Comment continues to store user linkage.
3. UI still shows user identity as today.

### Flow D — Sender cannot be matched to contact

1. Existing unmatched behavior is preserved.
2. UI fallback remains `Unknown User` only when neither user nor contact author can be resolved.

## UX / UI Notes

- In MSP ticket conversation (`CommentItem` / `TicketConversation`), contact-authored comments should display:
  - contact avatar treatment,
  - contact full name,
  - optional contact email line when available.
- Unknown-user fallback should only occur when both user and contact are unavailable.
- Keep existing comment badges/metadata display (internal/resolution/response source) unchanged.
- Do not change who can edit/delete comments in this phase; those checks remain tied to authenticated user identity.

## Requirements

### Functional Requirements

1. Add a nullable tenant-scoped contact reference on comments (e.g., `comments.contact_id`) and enforce FK integrity to `contacts`.
2. Extend shared comment types and model inputs to carry contact authorship (`contact_id`) in addition to existing user authorship (`author_id`/`user_id`).
3. Update shared ticket comment creation logic to persist contact reference when provided.
4. Ensure comment validation enforces tenant-safe contact references; reject invalid or cross-tenant contacts.
5. Keep author-type semantics aligned: external/customer comments remain client-side comments for response-state behavior.
6. Update inbound email new-ticket flow to pass matched contact ID on initial comment creation, even when no user is found.
7. Update inbound email reply flows (reply-token + thread-header paths) to resolve sender contact and pass contact ID for comment creation.
8. Preserve matched client-user behavior by continuing to pass `author_id` when available.
9. Update workflow runtime email action schemas/wiring to pass through contact authorship fields.
10. Update ticket details data assembly (`optimizedTicketActions` and client-portal equivalent) to build author display data from both users and contacts.
11. Update conversation/comment UI components to resolve and render contact-authored comments without user records.
12. Update ticket API comment payload shape as needed so contact-authored comments can be represented without invalid UUID assumptions for `created_by`.
13. Preserve existing behavior for internal/system comments and unknown fallback paths.
14. Add unit/integration/UI coverage for contact-only authorship across ticket rendering and inbound email paths.

### Non-functional Requirements

- No tenant isolation regressions.
- No breaking behavior for existing comments that lack contact authorship fields.
- Query changes should remain bounded and avoid N+1 lookups in ticket detail loading.

## Data / API / Integrations

- Likely data model change: add `comments.contact_id` (nullable) with tenant-scoped FK to `contacts(contact_name_id)`.
- Shared types to extend:
  - `packages/types/src/interfaces/comment.interface.ts`
  - `shared/models/ticketModel.ts` create-comment input/output shapes
  - email workflow action inputs where comments are created from inbound email
- Ticket detail loaders to enrich author data from `contacts` when `comments.user_id` is null but `comments.contact_id` is set.
- API layer (`TicketService` + ticket comment schemas) may need shape updates to represent contact authors cleanly.

## Security / Permissions

- Contact linkage writes must be server-side and tenant-scoped.
- Validate contact belongs to the same tenant before persisting.
- If ticket-client enforcement is required, validate contact client alignment with ticket client in write path.

## Observability

- No new telemetry/metrics requirements in this phase (core functionality only).

## Rollout / Migration

- Add migration for comment contact linkage column and FK/index.
- No mandatory historical backfill in this phase.
- Existing comments continue to render with fallback logic.

## Open Questions

1. Should contact-authored comments display as `Name (Contact)` or just `Name` with contact avatar styling?
2. Should we always store `contact_id` when `author_id` is present (denormalized dual linkage), or only when no user exists?
3. For replies where sender contact cannot be resolved, should we fallback to ticket-level `contact_name_id` as author, or keep unknown?
4. Which API contract do we want for comment author output: additive fields (`author_contact_id`, `author_name`) vs richer nested `author` object?
5. Should contact-authored comments be visible in client portal exactly as today (if ticket is visible), or gated differently?

## Acceptance Criteria (Definition of Done)

- A contact-only sender (no `users` row) replying by inbound email creates a comment that is rendered as that contact in ticket conversation.
- A contact-only sender creating a new inbound-email ticket produces initial comment authored by contact (not unknown fallback).
- Existing matched client-user inbound behavior continues to work and remains associated to user identity.
- Existing unmatched sender behavior remains stable with unknown fallback.
- Response-state transitions remain unchanged for client/contact replies.
- MSP ticket details and client-portal ticket details both render contact-authored comments without regressions.
