# Scratchpad — Ticket Contact Commentors + Inbound Email Contact Authorship

- Plan slug: `contact-commentors-inbound-email`
- Created: `2026-02-11`

## What This Is

Keep a lightweight, continuously-updated log of discoveries and decisions made while implementing this plan.

Prefer short bullets. Append new entries as you learn things, and also *update earlier notes* when a decision changes or an open question is resolved.

## Decisions

- (2026-02-11) Draft approach: represent contact-only comment authorship by adding `comments.contact_id` (tenant-scoped FK to `contacts.contact_name_id`) rather than creating a new author enum state.
- (2026-02-11) Preserve current semantic meaning of customer-authored comments as `author_type=client` for response-state transitions; `contact_id` carries identity when `user_id` is absent.
- (2026-02-11) Keep scope focused on core behavior (data model + comment creation + rendering + inbound email wiring + tests), no operational/observability extras unless requested.
- (2026-02-11) No mandatory historical backfill in phase 1; additive behavior for new/updated comments first.
- (2026-02-11) Canonical authorship contract is now explicit in shared types via `CommentAuthorship` (`author_type` + nullable `user_id` + nullable `contact_id`), and `IComment` mirrors this nullable dual-link model.
- (2026-02-11) Shared comment typing extension is implemented in `packages/types/src/interfaces/comment.interface.ts`; downstream loaders/components can now consume `comment.contact_id` without ad-hoc casting.

## Discoveries / Constraints

- (2026-02-11) `comments` previously had contact columns, but they were removed in `server/migrations/20250217202553_drop_contact_columns.cjs`.
- (2026-02-11) `TicketModel.createComment` currently maps `author_type=contact` to DB `author_type=client` and only persists `user_id`; no contact identity is stored today (`shared/models/ticketModel.ts`).
- (2026-02-11) Inbound new-ticket flow already resolves contact and optional client user (`findContactByEmail`) and sets `author_id` only when user exists; reply paths do not currently resolve contact (`shared/services/email/processInboundEmailInApp.ts`).
- (2026-02-11) MSP and client-portal ticket details render comments from `comments` + `userMap` sourced from `users`; comments with no `user_id` render as `Unknown User` (`packages/tickets/src/components/ticket/CommentItem.tsx`, `packages/tickets/src/actions/optimizedTicketActions.ts`, `packages/client-portal/src/actions/client-portal-actions/client-tickets.ts`).
- (2026-02-11) Ticket comment API schema currently expects `created_by` as UUID in responses, which is brittle for contact-only authors if `user_id` is null (`server/src/lib/api/schemas/ticket.ts`).
- (2026-02-11) `packages/types` had `IComment.user_id?: string` and no contact author linkage field; adding nullable `user_id` + `contact_id` in the base interface is required before loader/UI/API updates.
- (2026-02-11) Added migration scaffold `server/migrations/20260211190000_add_comments_contact_id.cjs` to reintroduce nullable `comments.contact_id`; FK/index are intentionally separated into the next step for checklist traceability.
- (2026-02-11) Migration `20260211190000_add_comments_contact_id.cjs` now includes `comments_tenant_contact_id_fk` (`tenant, contact_id -> contacts.tenant, contact_name_id`) and `comments_tenant_contact_id_idx` for bounded comment-author lookups.
- (2026-02-11) `shared/models/ticketModel.ts` comment creation schema and input types now accept optional `contact_id` with UUID validation.
- (2026-02-11) `TicketModel.createComment` now performs tenant-scoped contact validation (`contacts.contact_name_id` + `tenant`) and fails fast when `contact_id` is missing/out-of-tenant.
- (2026-02-11) `TicketModel.createComment` insert payload now writes `comments.contact_id` directly, enabling contact-only comments and dual-link comments (`user_id` + `contact_id`).
- (2026-02-11) Shared comment creation now updates `tickets.response_state` to `awaiting_internal` for non-internal `author_type=contact` comments; internal comments remain unchanged.
- (2026-02-11) `createCommentFromEmail` contract in `shared/workflow/actions/emailWorkflowActions.ts` now accepts optional `contact_id` to support contact-only comment authorship from inbound paths.
- (2026-02-11) `createCommentFromEmail` now forwards `contact_id` into `TicketModel.createComment`, so inbound email comments can persist contact authorship linkage.
- (2026-02-11) New-ticket inbound path now passes `contact_id` into `createCommentFromEmail` whenever sender contact is matched, regardless of whether a client user was resolved.
- (2026-02-11) Reply-token inbound path now resolves sender contact once per email and forwards both `contact_id` and resolved `author_id` (when present) to comment creation.
- (2026-02-11) Thread-header inbound reply path reuses the same sender-contact resolution and now forwards `contact_id`/`author_id` to comment creation.
- (2026-02-11) End-to-end inbound paths now support dual linkage (`author_id` + `contact_id`) when a matched contact has an associated client user, preserving user identity while keeping explicit contact authorship.
- (2026-02-11) Workflow action schemas now expose `contact_id` in `create_comment_from_email` (V2 runtime + legacy action registry), so workflow definitions can pass contact authorship explicitly.
- (2026-02-11) Workflow runtime implementations now pass `contact_id` through to shared comment creation (`create_comment_from_email`, `create_ticket_with_initial_comment`, and parsed-reply comment path with sender contact resolution fallback).
- (2026-02-11) MSP consolidated ticket loader now builds a `contactMap` keyed by `contact_name_id` for all `comments.contact_id` values, giving conversation rendering a first-class contact author source alongside `userMap`.
- (2026-02-11) Client-portal ticket details loader now also returns `contactMap` from `comments.contact_id`, keeping author resolution parity between MSP and portal views.
- (2026-02-11) Added `packages/tickets/src/lib/commentAuthorResolution.ts` as the shared author resolver with deterministic precedence: user author, then contact author, then unknown fallback.
- (2026-02-11) `CommentItem` now resolves authors via shared helper + `contactMap`, rendering contact-authored comments with contact name/email/avatar (without requiring `user_id`).
- (2026-02-11) Unknown-user fallback is now explicitly constrained to comments where neither `userMap[comment.user_id]` nor `contactMap[comment.contact_id]` resolves, via `resolveCommentAuthor` precedence.
- (2026-02-11) API comment payloads now support contact-authored rows by making `created_by` nullable and adding contact author fields (`author_contact_id/name/email`) from `TicketService.getTicketComments` + `ticketCommentResponseSchema`.
- (2026-02-11) `ticketEmailSubscriber` now resolves comment author identity from persisted `comments` row (`user_id`/`contact_id` + emails) and excludes author recipients by both user-id and email/contact in comment fan-out paths.
- (2026-02-11) Added focused unit coverage for `processInboundEmailInApp` covering contact-only authorship in new-ticket, reply-token, and thread-header paths (`shared/services/email/__tests__/processInboundEmailInApp.test.ts`).

## Commands / Runbooks

- (2026-02-11) Locate existing comments/inbound-email/authorship behavior:
  - `rg -n "author_type|author_id|Unknown User|processInboundEmailInApp|createCommentFromEmail" shared server packages -g"*.ts" -g"*.tsx"`
- (2026-02-11) Review current ticket conversation rendering path:
  - `sed -n '1,360p' packages/tickets/src/components/ticket/CommentItem.tsx`
  - `sed -n '180,320p' packages/tickets/src/actions/optimizedTicketActions.ts`
- (2026-02-11) Review inbound email creation/reply logic:
  - `sed -n '1,760p' shared/services/email/processInboundEmailInApp.ts`
  - `sed -n '680,820p' shared/workflow/actions/emailWorkflowActions.ts`
- (2026-02-11) Review legacy migration history for comments/contact linkage:
  - `rg -n "comments|contact_id|contact_name_id|author_type" server/migrations -g"*.cjs"`
- (2026-02-11) Validate canonical type updates:
  - `npx vitest run packages/types/src/interfaces/comment.interface.typecheck.test.ts`
- (2026-02-11) Verify inbound email comment wiring after runtime action changes:
  - `npx vitest run shared/workflow/actions/__tests__/emailWorkflowActions.responseSource.test.ts shared/services/email/__tests__/processInboundEmailInApp.test.ts`

## Links / References

- Plan folder: `ee/docs/plans/2026-02-11-contact-commentors-inbound-email`
- Existing related plan: `ee/docs/plans/2026-01-24-inbound-email-in-app-processing`
- Existing related plan: `ee/docs/plans/2026-02-05-ticket-response-source`
- Core files:
  - `shared/services/email/processInboundEmailInApp.ts`
  - `shared/workflow/actions/emailWorkflowActions.ts`
  - `shared/models/ticketModel.ts`
  - `packages/tickets/src/actions/optimizedTicketActions.ts`
  - `packages/tickets/src/components/ticket/TicketConversation.tsx`
  - `packages/tickets/src/components/ticket/CommentItem.tsx`
  - `packages/client-portal/src/actions/client-portal-actions/client-tickets.ts`
  - `server/src/lib/api/services/TicketService.ts`
  - `server/src/lib/api/schemas/ticket.ts`
  - `server/migrations/20250217202553_drop_contact_columns.cjs`

## Open Questions

- Should contact-authored comments display `Name (Contact)` or only `Name` with contact avatar semantics?
- Should we always persist `contact_id` alongside `user_id` for client users when available, or only for contact-only authors?
- For reply flows with unresolved sender contact but resolved ticket, should we fallback to ticket contact or keep unknown?
- Do we want API responses to expose additive flat fields or a nested `author` object for future-proofing?
- Should client portal display for contact-authored comments differ from MSP display in any way?
- (2026-02-11) Added cross-layer verification for contact-authored comment support: integration assertions in inbound webhook tests, UI-level author resolution tests, and API schema tests for nullable `created_by` + contact author fields.
- (2026-02-11) T001 complete: added migration contract test asserting `comments.contact_id` is created as nullable UUID (`server/src/test/unit/migrations/commentsContactAuthorshipMigration.test.ts`).
- (2026-02-11) T002 complete: migration contract test now verifies tenant-scoped FK/index wiring for `comments.contact_id -> contacts.contact_name_id`.
- (2026-02-11) T003 complete: migration contract test now asserts down-path cleanup removes FK, index, and `contact_id` column.
- (2026-02-11) T004 complete: added `TicketModel.createComment` unit suite covering contact author input acceptance with `contact_id` and no `author_id`.
- (2026-02-11) T005 complete: `TicketModel.createComment` test now asserts invalid `contact_id` format is rejected by input validation.
EOF && git add ee/docs/plans/2026-02-11-contact-commentors-inbound-email/tests.json ee/docs/plans/2026-02-11-contact-commentors-inbound-email/SCRATCHPAD.md && git commit -m "test(T005): reject malformed contact_id in createComment"- (2026-02-11) T006 complete: `TicketModel.createComment` tests cover tenant-safety by rejecting missing/cross-tenant `contact_id` lookups.
- (2026-02-11) T007 complete: `TicketModel.createComment` persistence test asserts inserted `comments` row contains `contact_id` for contact-authored comments.
EOF && git add ee/docs/plans/2026-02-11-contact-commentors-inbound-email/tests.json ee/docs/plans/2026-02-11-contact-commentors-inbound-email/SCRATCHPAD.md && git commit -m "test(T007): verify contact_id persistence on comment insert"- (2026-02-11) T008 complete: `TicketModel.createComment` tests now verify dual-link persistence when both `author_id` and `contact_id` are supplied.
- (2026-02-11) T009 complete: unit tests assert public contact-authored comments set ticket `response_state` to `awaiting_internal`.
- (2026-02-11) T010 complete: unit tests confirm internal contact-authored comments do not change ticket `response_state`.
- (2026-02-11) T011 complete: `createCommentFromEmail` unit coverage now verifies `contact_id` is forwarded into `TicketModel.createComment`.
- (2026-02-11) T012 complete: unit tests now assert dual forwarding of `author_id` and `contact_id` from `createCommentFromEmail`.
- (2026-02-11) T013 complete: unit tests cover new-ticket inbound flow with matched contact/no user and assert `contact_id` is set while `author_id` is omitted.
