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

## Discoveries / Constraints

- IMAP service already retries webhook dispatch on non-2xx responses.
- Existing IMAP in-app async queue implementation is in-memory and returns success after enqueue, which is not durable acceptance.
- Microsoft and Google callback handlers currently fetch and process in callback path; this plan changes them to enqueue-only ingress.
- Inbound email interface definitions are duplicated across `shared/interfaces`, `server/src/interfaces`, and `packages/types/src/interfaces`; all three must be kept in sync for type consumers.

## Commands / Runbooks

- `python3 /Users/roberisaacs/.codex/skills/alga-plan/scripts/scaffold_plan.py "Unified Inbound Email Queue with Pointer Jobs" --slug unified-inbound-email-pointer-queue`
- `python3 /Users/roberisaacs/.codex/skills/alga-plan/scripts/validate_plan.py ee/docs/plans/2026-03-01-unified-inbound-email-pointer-queue`
- `npm -w shared run typecheck`
- `npm -w @alga-psa/types run build`
- `npm -w server run typecheck`

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

## Progress Log

- (2026-03-01) Completed `F001`: Added unified pointer job contract types with provider-specific pointer metadata and queue lifecycle fields (`attempt`, `maxAttempts`, `enqueuedAt`, `jobId`, `schemaVersion`).

## Open Questions

- Choose Redis queue primitive for implementation phase: Streams with consumer groups vs list-based queue with explicit inflight tracking.
- Decide whether DLQ re-drive tooling is required in this scope or deferred.
