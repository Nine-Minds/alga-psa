# Scratchpad — Ticket Response Source

## Request

User asks for a new feature to show how a ticket response was received:

- Client Portal
- Inbound Email processing system

Targeted surfaces:

- `packages/tickets/src/components/ticket/TicketDetails.tsx`
- `packages/client-portal/src/components/tickets/TicketDetails.tsx`

## Discoveries

- Inbound email processing currently creates comments through:
  - `shared/services/email/processInboundEmailInApp.ts`
  - `shared/workflow/actions/emailWorkflowActions.ts#createCommentFromEmail`
- Inbound email comments already include rich `metadata.email` content and are authored as client/contact style comments.
- Client portal comments are inserted directly in:
  - `packages/client-portal/src/actions/client-portal-actions/client-tickets.ts#addClientTicketComment`
  - These currently do not set `metadata.responseSource`.
- `comments.metadata` JSONB exists (migration `20250917150000_add_metadata_to_comments.cjs`), so MVP can avoid schema migration.
- `IComment` type currently does not expose `metadata`, which makes source-based UI logic awkward/unsafe.

## Proposed MVP Strategy

1. Source tagging:
   - Write `metadata.responseSource=client_portal` for client portal comments.
   - Write `metadata.responseSource=inbound_email` for inbound email comments (in shared email comment creation path).
2. Source derivation:
   - Add shared utility to compute latest customer response source from conversation comments.
   - Prefer explicit metadata; fallback heuristics for older records.
3. UI:
   - Show source indicator in both ticket details surfaces near response-state context.

## Why This Approach

- No DB migration required.
- Works for Google, Microsoft, and IMAP because it centralizes inbound tagging at shared email comment creation.
- Backward compatible with legacy comments through heuristics.

## Risks / Gaps

- Historical records may be ambiguous if metadata is missing.
- Provider-specific labels depend on consistent provider metadata presence.

## Open Decisions To Confirm

1. Show source only when `response_state=awaiting_internal`, or whenever latest customer response source is known?
2. Generic inbound label vs provider-specific label in UI.
3. Ticket-level indicator only vs ticket-level + per-comment badges.
4. Do we need backfill for older comments in this phase?

## Implementation Log

### F001 — Canonical response source values

- Added canonical constants/types in `packages/types/src/interfaces/comment.interface.ts`:
  - `COMMENT_RESPONSE_SOURCES.CLIENT_PORTAL = "client_portal"`
  - `COMMENT_RESPONSE_SOURCES.INBOUND_EMAIL = "inbound_email"`
  - `CommentResponseSource` union derived from those constants.
- Rationale: single source of truth for source values shared by UI/action logic and tests.

### F002 — Shared comment metadata typing

- Extended `packages/types/src/interfaces/comment.interface.ts`:
  - Added `InboundEmailProviderType = "google" | "microsoft" | "imap"`.
  - Added `CommentMetadataEmail` and `CommentMetadata` with safe loose typing.
  - Added `IComment.metadata?: CommentMetadata | null`.
- Added optional normalized `IComment.response_source?: CommentResponseSource`.
- Rationale: unblock UI/action logic from using `any` for source resolution while staying backward-compatible with existing metadata shapes.

### F003 — Client portal writes response source

- Updated `packages/client-portal/src/actions/client-portal-actions/client-tickets.ts#addClientTicketComment` to persist:
  - `metadata.responseSource = "client_portal"` on inserted comments.
- Implementation uses canonical constants from `@alga-psa/types` (`COMMENT_RESPONSE_SOURCES.CLIENT_PORTAL`) to avoid string drift.

### F004 — Inbound email writes response source

- Added shared metadata normalizer in `shared/workflow/actions/emailWorkflowActions.ts`:
  - `buildInboundEmailCommentMetadata(...)`
  - `normalizeInboundEmailProvider(...)`
- `createCommentFromEmail` now always persists `metadata.responseSource = "inbound_email"` via the shared metadata builder before calling `TicketModel.createComment`.
- Rationale: centralize inbound source tagging in one path used by Google/Microsoft/IMAP ingestion to avoid per-caller drift.

### F005 — Inbound metadata carries provider type

- `buildInboundEmailCommentMetadata` now normalizes provider type to `google|microsoft|imap` when present.
- Persisted provider detail is written on `metadata.email.provider` and `metadata.email.providerType`.
- Updated `shared/services/email/processInboundEmailInApp.ts` to pass `metadata.email.provider = emailData.provider` in all inbound comment creation branches.

### F006 — Shared source derivation utility

- Added `packages/tickets/src/lib/responseSource.ts` with:
  - `getCommentResponseSource(comment)`
  - `getLatestCustomerResponseSource(conversations)`
- Exported utility from `packages/tickets/src/lib/index.ts` for use in both MSP and client-portal ticket detail surfaces.

### F007 — Internal exclusion + explicit precedence

- `getLatestCustomerResponseSource` now only evaluates customer-visible comments (`!is_internal`, `author_type in {client,contact}`).
- `getCommentResponseSource` resolves explicit metadata first:
  - `metadata.responseSource`
  - `response_source` fallback field
- Heuristics are only applied if explicit source is absent.

### F008 — Legacy inbound fallback

- Added fallback in `getCommentResponseSource`:
  - if `comment.metadata.email` exists and explicit source is absent, infer `inbound_email`.
- This supports historical comments that predate `metadata.responseSource`.

### F009 — Legacy client-portal fallback

- Added fallback in `getCommentResponseSource`:
  - if explicit source is absent and comment is `author_type=client` with `user_id`, infer `client_portal`.
- This keeps older client-authored comments source-identifiable without backfill migration.

### F010 — MSP TicketDetails indicator

- Added reusable UI component `packages/tickets/src/components/ResponseSourceBadge.tsx`.
- Updated `packages/tickets/src/components/ticket/TicketDetails.tsx`:
  - derives latest source with `getLatestCustomerResponseSource(conversations)`.
  - renders source indicator next to response-state badge in header/status area.

### F011 — Client portal TicketDetails indicator

- Updated `packages/client-portal/src/components/tickets/TicketDetails.tsx`:
  - derives latest source from `ticket.conversations`.
  - renders shared `ResponseSourceBadge` alongside existing response-state badge.

### F012 — i18n labels

- Added English locale keys:
  - `server/public/locales/en/clientPortal.json` → `tickets.responseSource.clientPortal|inboundEmail`
  - `server/public/locales/en/common.json` → `tickets.responseSource.clientPortal|inboundEmail`
- Both ticket detail screens now resolve labels through i18n keys with safe English fallbacks.

### F013 — Hide when unresolved

- Both TicketDetails screens render the response source indicator conditionally:
  - only when `getLatestCustomerResponseSource(...)` returns a non-null source.
- No placeholder/error UI is shown when source cannot be determined.

### F014 — Schema-light implementation

- Confirmed implementation uses existing `comments.metadata` JSONB only.
- No migration files were added/modified for this workstream.

### F015 — Shared inbound path coverage

- Google/Microsoft/IMAP inbound flows all route through `createCommentFromEmail` in:
  - `shared/services/email/processInboundEmailInApp.ts`
- Since source/provider tagging is centralized in `shared/workflow/actions/emailWorkflowActions.ts#createCommentFromEmail`, all three providers now share the same metadata behavior.

### F016 — Response-state behavior remains unchanged

- This implementation only adds metadata writes and UI read/display logic.
- No updates were made to response-state transition logic (`awaiting_client` / `awaiting_internal`) or ticket state machine code.

## Test Log

### T001 — Client portal metadata write

- Added test: `packages/client-portal/src/actions/client-portal-actions/client-tickets.responseSource.test.ts`
- Asserts `addClientTicketComment` inserts `metadata.responseSource = "client_portal"`.
- Also introduced `server/vitest.config.ts` alias for `@alga-psa/analytics` to support importing client-portal action modules in Vitest.
- Validation command:
  - `npx vitest run packages/client-portal/src/actions/client-portal-actions/client-tickets.responseSource.test.ts shared/workflow/actions/__tests__/emailWorkflowActions.responseSource.test.ts packages/tickets/src/lib/__tests__/responseSource.test.ts packages/tickets/src/components/ResponseSourceBadge.render.test.tsx packages/tickets/src/lib/__tests__/responseSourceLocales.test.ts packages/types/src/interfaces/comment.interface.typecheck.test.ts --config server/vitest.config.ts --coverage.enabled false`

### T002

- Covered by \: asserts \ passes \ to shared comment creation.

### T003

- Covered by \: asserts provider normalization writes \ when available.

### T004

- Covered by \: validates \ accepts metadata + normalized source fields.

### T005

- Covered by \: explicit inbound metadata on latest eligible comment resolves to \.

### T006

- Covered by \: explicit client portal metadata on latest eligible comment resolves to \.

### T007

- Covered by \: internal comments are ignored during source selection.

### T008

- Covered by \: fallback infers \ from legacy \.

### T009

- Covered by \: fallback infers \ for legacy client comment with \.

### T010

- Covered by \: returns \ when no eligible customer source can be resolved.

### T011

- Covered by \: MSP rendering contract contains \ for portal source.

### T012

- Covered by \: MSP rendering contract contains \ for inbound source.

### T013

- Covered by \: client-portal rendering contract resolves/prints portal-source label.

### T014

- Covered by \: client-portal rendering contract resolves/prints inbound-source label.

### T015

- Covered by \: unresolved source produces no indicator markup.

### T016

- Covered by \: legacy comments without metadata remain valid inputs and resolve safely without schema changes.

### T017

- Covered by \: google inbound provider path resolves/persists \.

### T018

- Covered by \: microsoft inbound provider path resolves/persists \.

### T019

- Covered by \: imap inbound provider path resolves/persists \.

### T020

- Covered by \: create-comment-from-email path remains non-internal/non-resolution and additive to response-state behavior.

### T021

- Covered by \: indicator output updates after adding a new client-portal comment (no full reload assumption).

### T022

- Covered by \: indicator output updates after adding inbound-email reply comment.
