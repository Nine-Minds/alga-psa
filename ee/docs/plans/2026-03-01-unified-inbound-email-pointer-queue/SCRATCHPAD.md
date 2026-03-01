# Scratchpad — Unified Inbound Email Queue with Pointer Jobs

- Plan slug: `unified-inbound-email-pointer-queue`
- Created: `2026-03-01`

## What This Is

Working notes for moving Microsoft, Google, and IMAP inbound email ingress to one pointer-based Redis queue with consume-time idempotency.

## Decisions

- (2026-03-01) Use one queue ingestion model for all inbound providers: Microsoft callback, Google callback, and IMAP listener enqueue pointer jobs only.
- (2026-03-01) Use consume-time idempotency instead of ingress-time idempotency.
- (2026-03-01) Queue payloads stay pointer-only (no raw MIME/attachment bytes).
- (2026-03-01) Source-content drift for IMAP between ingest and consume is accepted risk; unavailable source should produce deterministic skipped outcome.
- (2026-03-01) Ingress success must mean durable enqueue success.
- (2026-03-01) F001 implemented by defining `UnifiedInboundEmailQueueJob` as a discriminated union (`provider`) with provider-specific pointer objects (`microsoft`, `google`, `imap`), while keeping legacy `EmailQueueJob` for compatibility during migration.
- (2026-03-01) Added a dedicated unified queue feature flag gate (`UNIFIED_INBOUND_EMAIL_POINTER_QUEUE_*`) so provider webhooks can move to enqueue-only behavior without forcing immediate cutover.

## Discoveries / Constraints

- IMAP service already retries webhook dispatch on non-2xx responses.
- Existing IMAP in-app async queue implementation is in-memory and returns success after enqueue, which is not durable acceptance.
- Microsoft and Google callback handlers currently fetch and process in callback path; this plan changes them to enqueue-only ingress.
- Inbound email interface definitions are duplicated across `shared/interfaces`, `server/src/interfaces`, and `packages/types/src/interfaces`; all three must be kept in sync for type consumers.
- Microsoft webhook handler is transaction-scoped per notification; queue-mode enqueue can be inserted before legacy fetch/process logic and short-circuit the callback path cleanly.
- Google webhook flow can enqueue immediately after provider resolution + JWT verification, before any `gmail_processed_history` writes or Gmail API fetches.
- IMAP listener now has enough metadata at fetch time (`mailbox`, `uid`, `uidValidity`, `messageId`) to emit pointer-only webhook payloads; no raw body is required for unified queue ingress.
- Unified queue internals now track ready/processing/inflight/DLQ keys with lease metadata, enabling explicit claim and completion lifecycle management.

## Commands / Runbooks

- `python3 /Users/roberisaacs/.codex/skills/alga-plan/scripts/scaffold_plan.py "Unified Inbound Email Queue with Pointer Jobs" --slug unified-inbound-email-pointer-queue`
- `python3 /Users/roberisaacs/.codex/skills/alga-plan/scripts/validate_plan.py ee/docs/plans/2026-03-01-unified-inbound-email-pointer-queue`
- `npm -w shared run typecheck`
- `npm -w @alga-psa/types run build`
- `npm -w server run typecheck`
- `npm -w shared run typecheck` (after Microsoft queue-mode changes)
- `npm -w server run typecheck` (after Microsoft queue-mode changes)

## Links / References

- IMAP webhook route: `packages/integrations/src/webhooks/email/imap.ts`
- IMAP in-memory queue: `packages/integrations/src/webhooks/email/imapInAppQueue.ts`
- Microsoft webhook route: `packages/integrations/src/webhooks/email/microsoft.ts`
- Google webhook route: `packages/integrations/src/webhooks/email/google.ts`
- IMAP listener dispatch path: `services/imap-service/src/imapService.ts`
- Existing related plan: `ee/docs/plans/2026-02-27-inbound-email-inapp-artifact-persistence-remaining-work/`
- Unified job contract files:
  - `shared/interfaces/inbound-email.interfaces.ts`
  - `server/src/interfaces/email.interfaces.ts`
  - `packages/types/src/interfaces/email.interfaces.ts`
- Unified queue helper: `shared/services/email/unifiedInboundEmailQueue.ts`
- Unified queue flag gate helper: `shared/services/email/inboundEmailInAppFeatureFlag.ts`
- Unified queue consumer loop: `shared/services/email/unifiedInboundEmailQueueConsumer.ts`
- Server queue job processor: `server/src/services/email/unifiedInboundEmailQueueJobProcessor.ts`
- Server consumer entrypoint: `server/src/bin/unifiedInboundEmailQueueConsumer.ts`

## Progress Log

- (2026-03-01) Completed `F001`: Added unified pointer job contract types with provider-specific pointer metadata and queue lifecycle fields (`attempt`, `maxAttempts`, `enqueuedAt`, `jobId`, `schemaVersion`).
- (2026-03-01) Completed `F002`: Microsoft webhook now supports enqueue-only pointer handoff in unified-queue mode, using `shared/services/email/unifiedInboundEmailQueue.ts` and no longer requiring inline full-email fetch/processing when that mode is enabled.
- (2026-03-01) Completed `F003`: Google webhook now supports enqueue-only pointer handoff in unified-queue mode (`historyId`, `emailAddress`, `pubsubMessageId`) and returns `503` when durable enqueue fails.
- (2026-03-01) Completed `F004`: IMAP listener/webhook handoff now supports pointer-only ingress (`mailbox`, `uid`, `uidValidity`, optional `messageId`) and enqueues IMAP pointer jobs when unified queue mode is enabled.
- (2026-03-01) Completed `F005`: Unified pointer ingress is now persisted in Redis list storage via `shared/services/email/unifiedInboundEmailQueue.ts` (`RPUSH` on a configurable queue key).
- (2026-03-01) Completed `F006`: Unified queue mode ingress responses now acknowledge only after enqueue returns success; enqueue errors return non-success responses so callers can retry.
- (2026-03-01) Completed `F007`: Microsoft, Google, and IMAP unified-queue paths now return `503` when enqueue fails, preserving upstream retry behavior.
- (2026-03-01) Completed `F008`: Added a reusable consumer loop (`UnifiedInboundEmailQueueConsumer`) plus queue claim/ack/fail/reclaim primitives for processing unified inbound pointer jobs.
- (2026-03-01) Completed `F009`: Added provider-specific consume-time pointer resolution in `unifiedInboundEmailQueueJobProcessor` for Microsoft (`messageId`), Google (`historyId` -> message IDs), and IMAP (`uid` fetch) before downstream processing.
- (2026-03-01) Completed `F010`: Added consume-time idempotency insert/check against `email_processed_messages` with duplicate short-circuit when a normalized external identity already exists.
- (2026-03-01) Completed `F011`: Queue job processor now calls `processInboundEmailInApp` for fetched provider messages and records final processing status back to `email_processed_messages`.
- (2026-03-01) Completed `F012`: Consumer loop now ACKs only after `handleJob` completes successfully; failed jobs are not ACKed and are routed through retry/DLQ handling.
- (2026-03-01) Completed `F013`: Added lease-based reclaim (`reclaimExpiredUnifiedInboundEmailQueueJobs`) so stale in-flight jobs are resurfaced back to the ready queue.
- (2026-03-01) Completed `F014`: Failed jobs now increment `attempt` in queue payload state and only requeue while below configured `maxAttempts`.
- (2026-03-01) Completed `F015`: Once `attempt` reaches `maxAttempts`, failed jobs are routed to the dedicated unified inbound pointer DLQ key.
- (2026-03-01) Completed `F016`: Source-unavailable fetch failures now resolve as deterministic `skipped` outcomes (`source_unavailable:*`) recorded in `email_processed_messages` and do not rethrow for retry.
- (2026-03-01) Completed `F017`: Consumer idempotency now uses a normalized external identity format (`<provider>:<messageId>`) prior to persistence checks.

## Open Questions

- Choose Redis queue primitive for implementation phase: Streams with consumer groups vs list-based queue with explicit inflight tracking.
- Decide whether DLQ re-drive tooling is required in this scope or deferred.
