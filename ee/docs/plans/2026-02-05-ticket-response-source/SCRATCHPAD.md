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
