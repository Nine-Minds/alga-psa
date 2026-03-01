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
- Queue enqueue now enforces a runtime pointer-only payload guard that rejects forbidden MIME/body/attachment keys at both top-level and nested pointer metadata.
- Legacy IMAP in-memory async queue now rejects enqueue attempts when unified pointer queue mode is enabled for the same tenant/provider, preventing accidental production regressions to in-memory processing.
- Security checks are still enforced before enqueue-only handoff: Microsoft validation/clientState checks, Google Pub/Sub JWT verification, and IMAP secret header verification all execute before unified-queue enqueue paths.
- IMAP async-mode gating is now provider-aware and supports explicit legacy-path disablement via `IMAP_INBOUND_EMAIL_IN_APP_ASYNC_DISABLED`, while also auto-disabling async mode whenever unified pointer queue mode is enabled for a provider.
- Unified queue now emits structured event logs for `enqueue`, `consume_start`, `ack`, `retry`, `dlq`, `reclaim`, and consumer `skip` with job/pointer identifiers and attempt metadata.
- Microsoft webhook response contract now reports handoff mode (`unified_pointer_queue`/`mixed`/`inline_processing`) plus queue vs inline counts, aligning callback semantics with Google/IMAP queue-mode responses.
- Queue consumer provider routing is implemented in `processUnifiedInboundEmailQueueJob` via provider-specific pointer resolution paths: Microsoft (`messageId`), Google (`historyId` plus discovered message IDs), and IMAP (`uid` mailbox fetch).

## Commands / Runbooks

- `python3 /Users/roberisaacs/.codex/skills/alga-plan/scripts/scaffold_plan.py "Unified Inbound Email Queue with Pointer Jobs" --slug unified-inbound-email-pointer-queue`
- `python3 /Users/roberisaacs/.codex/skills/alga-plan/scripts/validate_plan.py ee/docs/plans/2026-03-01-unified-inbound-email-pointer-queue`
- `npm -w shared run typecheck`
- `npm -w @alga-psa/types run build`
- `npm -w server run typecheck`
- `npm -w shared run typecheck` (after Microsoft queue-mode changes)
- `npm -w server run typecheck` (after Microsoft queue-mode changes)
- `npm -w imap-service run build`
- `npm -w @alga-psa/integrations run typecheck`
- `npm -w server run test -- src/test/integration/microsoftWebhookUnifiedQueue.integration.test.ts`
- `npm -w server run test -- src/test/integration/googleWebhookUnifiedQueue.integration.test.ts --coverage.enabled=false`
- `npm -w server run test -- src/test/integration/imapWebhookHandoff.integration.test.ts --coverage.enabled=false`
- `npm -w server run test -- src/test/integration/microsoftWebhookUnifiedQueue.integration.test.ts src/test/integration/googleWebhookUnifiedQueue.integration.test.ts src/test/integration/imapWebhookHandoff.integration.test.ts --coverage.enabled=false`
- `npx vitest --config shared/vitest.config.ts services/imap-service/src/imapService.webhookRetry.test.ts`
- `npx vitest --config shared/vitest.config.ts shared/services/email/__tests__/unifiedInboundEmailQueueConsumer.test.ts`
- `npm -w server run test -- src/test/unit/unifiedInboundEmailQueueJobProcessor.fetch.test.ts --coverage.enabled=false`

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
- Unified queue runbook: `ee/docs/plans/2026-03-01-unified-inbound-email-pointer-queue/RUNBOOK.md`
- Microsoft unified ingress contract tests: `server/src/test/integration/microsoftWebhookUnifiedQueue.integration.test.ts`
- Google unified ingress contract tests: `server/src/test/integration/googleWebhookUnifiedQueue.integration.test.ts`
- IMAP webhook retry test: `services/imap-service/src/imapService.webhookRetry.test.ts`
- Unified queue consumer tests: `shared/services/email/__tests__/unifiedInboundEmailQueueConsumer.test.ts`
- Unified queue job processor fetch tests: `server/src/test/unit/unifiedInboundEmailQueueJobProcessor.fetch.test.ts`

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
- (2026-03-01) Completed `F018`: Added `assertPointerOnlyPayload` validation in enqueue to reject raw content-like keys (`rawMime`, `attachments`, `body`, etc.) and enforce pointer-only queue contracts at runtime.
- (2026-03-01) Completed `F019`: Added a defensive runtime guard in `imapInAppQueue` that throws when unified pointer queue mode is enabled for the tenant/provider, ensuring legacy in-memory queue path is bypassed/retired for production unified-mode processing.
- (2026-03-01) Completed `F020`: Verified webhook auth/verification behavior is preserved in enqueue-only mode across Microsoft, Google, and IMAP paths (no auth bypass introduced by unified queue branching).
- (2026-03-01) Completed `F021`: Aligned queue migration flags by extending IMAP async mode evaluation to accept provider context, auto-disable on unified mode, and honor `IMAP_INBOUND_EMAIL_IN_APP_ASYNC_DISABLED` for explicit legacy disablement.
- (2026-03-01) Completed `F022`: Added structured observability events across queue lifecycle and consumer skip outcomes, including tenant/provider/pointer identifiers, attempts, and terminal reasons for retry/DLQ paths.
- (2026-03-01) Completed `F023`: Updated provider callback contracts so unified mode explicitly reports queue handoff metadata and avoids inline-processing ambiguity in webhook responses.
- (2026-03-01) Completed `F024`: Confirmed unified consumer routing dispatches per provider type and fetches provider-specific source payloads before shared in-app processing.
- (2026-03-01) Completed `F025`: Added a dedicated runbook covering architecture, queue keys, feature flags, consumer startup, and local validation/failure-path checks.
- (2026-03-01) Completed `T001`: Added Microsoft unified ingress contract test validating pointer-only enqueue payload shape (`tenantId`, `providerId`, provider pointer identifiers) and absence of raw content fields.
- (2026-03-01) Completed `T002`: Added Google unified ingress contract test validating pointer-only enqueue payload shape (`tenantId`, `providerId`, `historyId`, `pubsubMessageId`) behind successful JWT/provider verification.
- (2026-03-01) Completed `T003`: Extended IMAP webhook integration coverage with unified-mode pointer enqueue assertions (`mailbox`, `uid`, `uidValidity`, `messageId`) and pointer-only payload guards.
- (2026-03-01) Completed `T004`: Added deferred-enqueue Microsoft webhook test proving `200` success is not returned until unified queue enqueue promise resolves.
- (2026-03-01) Completed `T005`: Added deferred-enqueue Google webhook test proving callback success response is blocked until unified queue enqueue completion.
- (2026-03-01) Completed `T006`: Added deferred-enqueue IMAP webhook test proving unified-mode success response is blocked until pointer job enqueue completion.
- (2026-03-01) Completed `T007`: Added enqueue-failure assertions for Microsoft, Google, and IMAP unified ingress paths, each returning `503` to preserve upstream retry semantics.
- (2026-03-01) Completed `T008`: Extracted and tested IMAP webhook retry helper to verify non-2xx ingress responses trigger retry attempts before eventual success.
- (2026-03-01) Completed `T009`: Added consumer unit coverage confirming Microsoft pointer claims invoke handler and ACK path through unified consumer loop.
- (2026-03-01) Completed `T010`: Validated Google pointer claims execute through the same unified consumer claim/handle/ACK lifecycle.
- (2026-03-01) Completed `T011`: Validated IMAP pointer claims execute through the same unified consumer claim/handle/ACK lifecycle.
- (2026-03-01) Completed `T012`: Added processor fetch test proving Microsoft pointer jobs resolve full provider payloads before shared in-app processing execution.

## Open Questions

- Choose Redis queue primitive for implementation phase: Streams with consumer groups vs list-based queue with explicit inflight tracking.
- Decide whether DLQ re-drive tooling is required in this scope or deferred.
