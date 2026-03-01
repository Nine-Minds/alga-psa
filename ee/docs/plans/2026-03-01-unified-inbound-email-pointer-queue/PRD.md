# PRD — Unified Inbound Email Queue with Pointer Jobs

- Slug: `unified-inbound-email-pointer-queue`
- Date: `2026-03-01`
- Status: Draft

## Summary

Unify inbound email handling so Microsoft callbacks, Google callbacks, and the IMAP listener all enqueue pointer-based jobs into one Redis-backed queue. A single email processor consumes jobs, fetches full email content at consume time, and runs existing in-app processing.

## Problem

Inbound email ingestion currently has split execution paths, including direct callback processing and IMAP-specific in-memory async queue behavior. This causes inconsistent reliability, duplicate handling differences, and different failure semantics across providers.

## Goals

- Move all providers to one ingestion contract: ingress validates and durably enqueues pointer jobs.
- Process email in one consumer path using consume-time idempotency.
- Remove dependence on in-memory queue acceptance semantics.
- Keep queue payloads lightweight by storing pointers, not full email bytes.
- Preserve existing ticket/comment/document outcomes produced by in-app processing.

## Non-goals

- Rewriting ticket/comment/document business logic.
- Introducing a brand-new external broker beyond existing Redis.
- Guaranteeing immutable IMAP message content between ingest and consume.
- Adding new UI surfaces for queue management in this scope.

## Users and Primary Flows

1. Email provider webhook/listener ingress
- Microsoft webhook receives notification pointer and enqueues.
- Google webhook receives Pub/Sub pointer (`historyId`/address) and enqueues.
- IMAP listener observes new message pointer and enqueues.

2. Email processing worker
- Worker pops job, resolves provider context, fetches full email content from source.
- Worker performs consume-time idempotency check.
- Worker runs inbound in-app processing pipeline.
- Worker ACKs on success, retries on failure, and sends to DLQ on terminal failure.

3. Retry and duplicate handling
- If ingress cannot durably enqueue, it returns non-2xx so sender retries.
- If consumer fails before ACK, job resurfaces and retries.
- If duplicate message is consumed, idempotency no-ops duplicate processing.

## UX / UI Notes

- No net-new user-facing workflow is required.
- Existing ticket and document surfaces should continue to show the same outcomes as current in-app processing.

## Requirements

### Functional Requirements

- Add a unified inbound queue job schema supporting provider-specific pointers:
  - Microsoft: provider/subscription + message id pointer.
  - Google: provider + history pointer (and any derived message pointer metadata).
  - IMAP: provider + mailbox/UID/message pointer.
- Update all three ingress paths to enqueue pointer jobs only.
- Ingress endpoints/listeners must only report success after durable queue enqueue success.
- Implement a queue consumer that:
  - claims jobs,
  - fetches full email payload from source,
  - applies consume-time idempotency,
  - executes existing `processInboundEmailInApp` pipeline,
  - ACKs only on successful handling.
- Support retry with bounded attempts and DLQ transfer.
- Support job resurfacing when ACK is not recorded.
- Handle unavailable/moved/deleted source messages by recording a deterministic skipped outcome.
- Replace or retire IMAP in-memory async queue code path in favor of the unified queue.

### Non-functional Requirements

- Queue payloads remain pointer-only and do not include attachment bytes or MIME bodies.
- Queue and consumer behavior must be deterministic enough to support at-least-once delivery semantics.
- Callback/listener latency should remain bounded by enqueue-only work.

## Data / API / Integrations

- Redis is the durable temporary queue store.
- Existing provider APIs remain source of truth for message content retrieval at consume time.
- Consumer invokes existing in-app inbound processing contracts after payload enrichment.
- Add/extend persistence for consume-time idempotency records keyed by normalized external message identity.

## Security / Permissions

- Preserve existing webhook authentication/verification rules for Microsoft, Google, and IMAP.
- Ensure queued job payload contains only minimally necessary metadata.
- Maintain tenant isolation in queue job schema and consume-time fetch.

## Observability

- Structured logs at ingress enqueue, consume start, retry, ack, and DLQ events.
- Include provider, tenant, pointer identifiers, attempt count, and terminal status reason.

## Rollout / Migration

- Introduce feature flag/env control for unified queue path.
- Migrate Microsoft and Google callback paths to enqueue-only mode.
- Migrate IMAP listener path to enqueue-only mode and disable legacy in-memory queue mode.
- Validate end-to-end behavior in local GreenMail + provider test paths before wider rollout.

## Open Questions

- Whether Google pointer jobs should carry only `historyId` or also optional snapshot of discovered message ids when available.
- Whether to expose DLQ re-drive tooling in this scope or leave as operator script only.

## Acceptance Criteria (Definition of Done)

- Microsoft, Google, and IMAP ingress all enqueue pointer jobs and do not perform full business processing inline.
- Ingress success response is tied to durable enqueue success.
- Consumer fetches email at consume time and executes existing in-app processing for all three providers.
- Consumer idempotency prevents duplicate downstream processing for the same message identity.
- Failed jobs retry and eventually land in DLQ after max attempts.
- IMAP in-memory async queue path is no longer used for production processing.
