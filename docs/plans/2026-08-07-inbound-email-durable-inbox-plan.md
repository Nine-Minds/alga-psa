# Durable inbound email processing

## Intent

Make Redis an at-least-once wake-up mechanism and make Postgres the correctness boundary for inbound email. A provider message may be fetched, queued, reclaimed, and delivered more than once, but it must create at most one ticket and at most one comment for that message. A worker crash must leave durable work that can be resumed instead of turning an existing `processing` audit row into a false duplicate.

The core guarantee is exactly-once ticket/comment effects within Postgres, not distributed exactly-once delivery across Postgres, Redis, provider APIs, object storage, and notification consumers.

## Evidence and current failure mechanics

The current path is split across `shared/services/email/unifiedInboundEmailQueueJobProcessor.ts`, `shared/services/email/processInboundEmailInApp.ts`, `shared/workflow/actions/emailWorkflowActions.ts`, and the Redis queue/consumer modules.

1. The queue contains provider pointers. `processUnifiedInboundEmailQueueJob` fetches and parses the provider source, then `insertProcessingRecord` inserts `email_processed_messages(processing_status = 'processing')` before any ticket/comment write.
2. `insertProcessingRecord` catches every `23505` and returns `false`. The processor does not load or classify the existing row; it increments `dedupedCount` and continues. A terminal row, a live worker, a failed attempt, and an abandoned `processing` row are therefore indistinguishable.
3. `UnifiedInboundEmailQueueConsumer.runOnce` ACKs every normally returned result, including `outcome: 'skipped'` and a job whose only result was the false dedupe above. In the observed failure, the first worker died after the `processing` insert and before core writes; the retry hit the unique key, returned normally, and was ACKed. The audit row remained `processing` and no ticket/comment existed.
4. Redis claims default to 60 seconds while the handler timeout defaults to 90 seconds. There is no heartbeat or claim token. `ack`, `fail`, and reclaim mutate Redis state without proving the caller still owns the claim. Reclaim itself is a read followed by an unfenced multi-command update, so a slow worker can overlap a reclaimed delivery and an old worker can ACK newer work.
5. `processInboundEmailInApp` uses JSON lookups (`tickets.email_metadata` and `comments.metadata`) as check-then-act dedupe. There is no database uniqueness constraint over the inbound identity, so concurrent workers can both pass the lookup.
6. `createTicketFromEmail` and `createCommentFromEmail` each open their own `withAdminTransaction`. The new-ticket path therefore commits the ticket before it creates the initial comment. Reply reopen/activity changes, the comment, watch-list changes, artifacts, and the final audit update also span separate transactions.
7. `WorkflowEventPublisher` publishes to the Redis event bus while ticket/comment helpers are executing. There is no repository transactional outbox. Publication can occur for a transaction that later rolls back, or fail after a core commit without a durable retry record. Existing payload idempotency keys do not make the Redis write atomic with Postgres.
8. Attachments are best effort after the comment. `email_processed_attachments` provides a useful audit/idempotency key, but its stale `processing` takeover has no lease token and a live `processing` row is returned as `success: true, duplicate: true`. Provider attachment fetches and uploads are not recoverable if the provider source later disappears.
9. Provider producers advance or persist source cursors around pointer handoff. IMAP already has the raw MIME when it dispatches the handoff; Microsoft and Google jobs fetch later. Once a provider message has moved or disappeared, a pointer-only retry cannot recreate the source.
10. `email_processed_messages` is consumed by reporting and older email processing code. It must not be dropped or silently repurposed during this migration.

Increasing the email-service heap or the Redis TTL can reduce the frequency of the incident, but neither closes these correctness gaps.

## Chosen architecture

Add a durable ingress record, a per-message inbox state machine, a database effect ledger, a per-artifact state machine, and a transactional outbox. All new tables are tenant-distributed and colocated. Keep `email_processed_messages` and `email_processed_attachments` as compatibility/audit surfaces, but stop using either legacy table as the authoritative core claim.

The flow is:

1. Persist a provider notification/poll pointer in `inbound_email_ingress` before relying on Redis.
2. A staging worker claims the ingress row, fetches the source, writes raw MIME to a deterministic object key, derives a normalized message identity/envelope, and inserts one `inbound_email_inbox` row per message. Google history notifications may fan out to several inbox rows.
3. Redis jobs contain only a versioned work type plus the durable ingress/inbox/outbox ID. A periodic recovery job can recreate every missing wake-up from Postgres.
4. A processing worker performs expensive source download, MIME parsing, routing reads, and command preparation outside the final transaction while renewing its leases.
5. One short tenant-colocated Postgres transaction locks the inbox row, verifies the fencing token, creates the ticket/comment effects, records effect keys, inserts outbox rows, and makes the inbox terminal.
6. Artifact and outbox workers resume independently. Their failures never recreate or erase the core ticket/comment.
7. A compatibility mirror/reconciler updates the existing audit tables after the core commit. The new inbox is authoritative if the mirror lags.

## Identity normalization

The authoritative idempotency identity is `(tenant, provider_id, normalized_message_id)`.

Create one shared `normalizeInboundMessageIdentity` function and use it at staging, backfill, effect creation, and reconciliation. It must never use a queue job ID.

- Prefer the RFC 5322 `Message-ID` from the staged source. Trim whitespace, remove one surrounding pair of angle brackets, preserve the local part, lowercase only the domain, and prefix it with `rfc822:`.
- If the header is absent, use a provider-native stable ID as `provider:<provider_type>:<opaque-id>`; trim surrounding whitespace but do not lowercase opaque IDs.
- For IMAP without either ID, use `imap:<mailbox>:<uidvalidity>:<uid>`. A UID without UIDVALIDITY is not a durable identity and must remain retryable/terminal according to source availability, not be replaced by a random value.
- Persist both the normalized key and the original provider/RFC identifiers for diagnostics. Hash the normalized key when constructing object-storage paths so message identifiers and subjects are not exposed in keys.

## Additive schema and Citus constraints

Implement the schema in a new migration, using `server/migrations/utils/citusDistribution.cjs`. Register every table as tenant-scoped in `packages/db/src/lib/tenantTableMetadata.ts`. Create and distribute parents before children: ingress, inbox, effects/artifacts/outbox. Set `exports.config = { transaction: false }` because `create_distributed_table` cannot run in a migration transaction.

Every primary key, unique constraint, and unique index includes `tenant`. All new tables are distributed on `tenant` and colocated with `tenants`. Composite foreign keys include `tenant`. Do not add FKs from the new ledger rows to `email_providers`, `tickets`, `comments`, files, or documents: provider/entity deletion must not destroy audit history, and soft entity references avoid Citus/local-table and deletion-order coupling. The only new FKs are within the new colocated table family.

### `inbound_email_ingress`

One row per durable provider pointer or already-available source handoff.

| Column | Definition |
| --- | --- |
| `tenant` | UUID, not null |
| `ingress_id` | UUID, not null, generated |
| `provider_id` | UUID, not null, soft reference |
| `provider_type` | text, one of `microsoft`, `google`, `imap` |
| `ingress_key` | text, deterministic provider notification/poll identity |
| `provider_pointer` | JSONB, not null, bounded pointer metadata only |
| `status` | text, default `received` |
| `attempt_count` | integer, default 0, non-negative |
| `lease_owner` | text, nullable |
| `lease_token` | UUID, nullable; random ownership token |
| `lease_version` | bigint, default 0; monotonic fencing value |
| `lease_expires_at` | timestamptz, nullable |
| `next_attempt_at` | timestamptz, nullable |
| `last_error`, `error_details` | text and JSONB, nullable |
| `received_at`, `created_at`, `updated_at`, `completed_at` | timestamptz |

Constraints and indexes:

- Primary key `(tenant, ingress_id)`.
- Unique `(tenant, provider_id, ingress_key)`.
- Check `status IN ('received','staging','staged','retryable_failed','terminal_failed')`.
- `staging` requires all lease fields; `retryable_failed` requires `next_attempt_at`; terminal states require `completed_at` and cleared lease fields.
- Due-work index `(tenant, status, next_attempt_at, lease_expires_at)`.

Ingress-key examples are `message:<graph-message-id>`, `history:<history-id>:<pubsub-message-id>`, and `mailbox:<mailbox>:uidvalidity:<value>:uid:<uid>`. Ingress uniqueness reduces redundant fetches; inbox uniqueness remains the domain correctness guard.

### `inbound_email_inbox`

One row per staged provider message and the authoritative core state machine.

| Column | Definition |
| --- | --- |
| `tenant`, `inbox_id` | UUID composite primary key |
| `ingress_id` | UUID, normally not null; composite FK with tenant to ingress |
| `provider_id`, `provider_type` | provider identity/type |
| `normalized_message_id` | text, not null |
| `provider_message_id`, `rfc_message_id` | original identities, nullable |
| `source_object_key`, `source_sha256` | text, required for processable rows |
| `source_size_bytes` | bigint, non-negative, required for processable rows |
| `source_staged_at` | timestamptz, required for processable rows |
| `envelope` | JSONB, not null; normalized headers/body metadata and attachment manifest, no attachment base64 |
| `legacy_imported` | boolean, not null, default false |
| `status` | text, default `received` |
| `attempt_count` | integer, default 0, non-negative |
| `lease_owner`, `lease_token`, `lease_version`, `lease_expires_at` | same semantics as ingress |
| `next_attempt_at` | timestamptz, nullable |
| `outcome_kind` | nullable: `created`, `replied`, `skipped`, `reconciled` |
| `outcome_reason` | text, nullable |
| `ticket_id`, `comment_id` | UUID soft result references, nullable until core completion |
| `last_error`, `error_details` | latest failure plus structured provenance |
| `received_at`, `created_at`, `updated_at`, `completed_at` | timestamptz |

Constraints and indexes:

- Primary key `(tenant, inbox_id)`.
- Unique `(tenant, provider_id, normalized_message_id)`; this is the first serialization point.
- FK `(tenant, ingress_id)` to `inbound_email_ingress(tenant, ingress_id)`.
- Check `status IN ('received','processing','succeeded','skipped','retryable_failed','terminal_failed')`.
- `processing` requires lease owner/token/expiry; `retryable_failed` requires `next_attempt_at`; terminal states require `completed_at` and cleared leases.
- Unless `legacy_imported = true` and the row is terminal, `ingress_id`, `source_object_key`, `source_sha256`, `source_size_bytes`, and `source_staged_at` are all required. A source-less legacy import can never transition back to a processable status.
- `succeeded` with `outcome_kind IN ('created','replied','reconciled')` requires `ticket_id` and `comment_id`. A reply records its target ticket and created comment. An intentional `skipped` requires `outcome_reason` and no effect rows.
- Due-work index `(tenant, status, next_attempt_at, lease_expires_at)` and terminal lookup index `(tenant, provider_id, normalized_message_id, status)`.

### `inbound_email_effects`

This is the second, independent database guard against check-then-act races and the reconciliation ledger.

| Column | Definition |
| --- | --- |
| `tenant`, `provider_id`, `normalized_message_id` | inbound identity |
| `effect_type` | `ticket` or `comment` |
| `inbox_id` | UUID, not null |
| `entity_id` | UUID, not null; ticket ID for `ticket`, comment ID for `comment` |
| `ticket_id` | UUID, not null; parent/target ticket for either effect |
| `reconciled` | boolean, default false |
| `created_at` | timestamptz |

Constraints:

- Primary key `(tenant, provider_id, normalized_message_id, effect_type)`. Thus one message can own at most one ticket effect and at most one comment effect. A reply has only the comment effect; a new ticket has both.
- Unique `(tenant, inbox_id, effect_type)`.
- FK `(tenant, inbox_id)` to the inbox.

Insert effect rows in the same transaction as their entity writes. If a concurrent transaction somehow gets beyond the inbox row lock, the losing effect insert raises a uniqueness conflict and rolls back all of that transaction's ticket/comment writes. Reconciliation may insert an effect row pointing to a pre-existing entity with `reconciled = true`.

### `inbound_email_artifacts`

Track attachment, embedded-image, and original-email persistence independently from core processing.

| Column | Definition |
| --- | --- |
| `tenant`, `inbox_id`, `artifact_key` | composite primary key; artifact key is deterministic |
| `artifact_type` | `attachment`, `embedded_image`, or `original_email` |
| `source_attachment_id`, `content_digest`, `storage_key` | source/deterministic storage identity |
| `status` | `pending`, `processing`, `succeeded`, `skipped`, `retryable_failed`, `terminal_failed` |
| `attempt_count`, `lease_owner`, `lease_token`, `lease_version`, `lease_expires_at`, `next_attempt_at` | retry/fencing fields |
| `file_id`, `document_id` | nullable output soft references |
| `last_error`, `created_at`, `updated_at`, `completed_at` | audit fields |

Use primary key `(tenant, inbox_id, artifact_key)`, FK `(tenant, inbox_id)` to the inbox, and due-work index `(tenant, status, next_attempt_at, lease_expires_at)`. A deterministic artifact key is `<artifact-type>:<stable-attachment-id-or-content-digest>`; deterministic storage paths are derived from tenant, inbox ID, artifact key, and digest.

Retain `email_processed_attachments`. The new worker mirrors final artifact outcomes to it for diagnostics/older readers, but the legacy table's unfenced `processing` row is no longer an authority.

### `inbound_email_outbox`

One durable row per semantic event/notification caused by the core transaction.

| Column | Definition |
| --- | --- |
| `tenant`, `outbox_id` | UUID composite primary key |
| `inbox_id` | UUID, not null |
| `event_key` | deterministic semantic key such as `ticket-created`, `ticket-assigned`, `initial-comment-created`, or `reply-comment-created` |
| `event_type` | existing event-bus type |
| `payload`, `publish_options` | JSONB, not null/nullable |
| `status` | `pending`, `publishing`, `published`, `retryable_failed`, `terminal_failed` |
| `attempt_count`, `lease_owner`, `lease_token`, `lease_version`, `lease_expires_at`, `next_attempt_at` | retry/fencing fields |
| `published_at`, `last_error`, `created_at`, `updated_at` | audit fields |

Constraints:

- Primary key `(tenant, outbox_id)`.
- Unique `(tenant, inbox_id, event_key)` so replay cannot create another logical notification.
- FK `(tenant, inbox_id)` to the inbox.
- Due-work index `(tenant, status, next_attempt_at, lease_expires_at)`.

Use `outbox_id` as the caller-supplied event ID and as the payload idempotency key on every publish retry. Extend the event-bus publisher interface narrowly so it can preserve a supplied event ID instead of generating a new UUID. Consumers that produce notifications for these inbound events must dedupe that ID before producing an external effect. The outbox remains at-least-once: a crash after Redis accepts a publish but before Postgres records `published` can redeliver the same ID.

## State-machine and claim rules

Implement claims as single conditional `UPDATE ... RETURNING` statements scoped by tenant and record ID. A successful claim increments `attempt_count` and `lease_version`, writes a new random `lease_token`, and sets an expiry. All renewals, terminal writes, failure writes, and releases include `(tenant, id, lease_version, lease_token)` in their predicate. A zero-row update means ownership was lost and the worker must stop without publishing or ACKing as success.

Allowed inbox transitions are:

- `received -> processing`.
- `retryable_failed -> processing` only when `next_attempt_at <= now()`.
- `processing -> processing` only through an atomic reclaim where `lease_expires_at <= now()`; reclaim installs a new token/version and preserves prior errors/attempt count.
- `processing -> succeeded | skipped | retryable_failed | terminal_failed` only for the current token/version.
- Terminal states never transition during normal processing. Reconciliation can fill missing entity IDs/effect rows without changing an already correct terminal outcome.

Ingress, artifact, and outbox rows use the analogous `received/pending -> processing -> terminal-or-retryable` rules. Use bounded exponential backoff with jitter and a configured terminal attempt limit, while retaining every row and its latest structured failure. Never delete a durable record to force a retry.

When an inbox identity already exists:

- `succeeded` or intentional `skipped`: return the stored outcome/entity IDs; ACK the wake-up.
- `processing` with an unexpired lease: return `defer` with its expiry; do not classify it as a duplicate or ACK it as successful work.
- `processing` with an expired lease: atomically reclaim it.
- due `retryable_failed`: atomically reclaim it.
- `terminal_failed`: return the stored terminal failure and ACK; recovery requires an explicit operator/reconciliation action, not silent recreation.

## Core transaction and helper refactors

Split `processInboundEmailInApp` into preparation and commit phases.

Preparation loads the staged MIME, verifies `source_sha256`, parses the body/attachments, resolves sender/routing/thread targets, builds ticket/comment commands, and creates artifact manifests. It does no domain writes and holds no Postgres transaction. Before commit, verify/renew the inbox lease and then pass the prepared command plus the current fencing token into the transaction.

The short core transaction must:

1. Select the inbox row `FOR UPDATE` by `(tenant, inbox_id)` and verify `status = 'processing'`, the current `lease_token`/`lease_version`, and a non-expired lease.
2. Re-read any effect rows. If the inbox/effects are terminal, return the recorded outcome without writes.
3. During migration reconciliation only, query the existing ticket/comment metadata and link exactly one unambiguous entity before creating anything. Ambiguous matches become `terminal_failed` for operator review.
4. For a new-ticket command, create the ticket and its initial comment through the same transaction. For a reply command, create the one comment in this transaction; include deterministic reopen/status activity and required watch-list mutations in the same transaction rather than committing them earlier.
5. Insert `ticket` and/or `comment` rows in `inbound_email_effects` in the same transaction. Treat uniqueness conflict as a transaction-level reconciliation signal, never as a generic successful dedupe.
6. Use an injected `InboundEmailOutboxEventPublisher` so calls made by `TicketModel` insert deterministic outbox rows instead of writing Redis. Keep `WorkflowAnalyticsTracker` as its current no-op/logging adapter.
7. Update the inbox with `ticket_id`, `comment_id`, outcome, terminal status, `completed_at`, and cleared lease fields using the fencing predicate. A zero-row result throws and rolls back the entire transaction.
8. Commit. Only after this point may the queue ACK or artifact/outbox work begin.

Refactor `createTicketFromEmail` and `createCommentFromEmail` to accept an execution options object containing an existing `Knex.Transaction` and injected event/analytics adapters. Use the existing `withAdminTransaction(callback, existingConnection)` capability so existing callers retain their current self-owned transaction behavior while the inbound orchestrator supplies one transaction to both helpers. Do not fork the ticket/comment creation logic into a second implementation.

The legacy JSON lookups remain only as migration reconciliation aids. Normal processing relies on the locked inbox plus `inbound_email_effects` constraints.

## Durable source staging

Add a source-staging service used by every producer path.

- Persist/upsert `inbound_email_ingress` before enqueueing Redis. If enqueue fails, return the appropriate retryable webhook response where applicable; the persisted row is also recovered by the sweeper.
- IMAP already has `message.source`. Upload and register that raw MIME before `recordLastProcessedMessageId` or advancing `last_uid`/folder state. Its queue handoff should reference the resulting durable inbox/ingress ID, not require another IMAP fetch.
- Microsoft and Google staging workers use the existing adapters (`downloadMessageSource`/message-detail APIs), upload raw MIME, and derive inbox rows before the corresponding reconciliation/history cursor is advanced. A push endpoint may acknowledge after the ingress pointer is committed so it remains responsive, but the message is not considered staged or processable until object upload and inbox insertion succeed.
- Upload to a deterministic key such as `inbound-email/<tenant>/<provider-id>/<sha256(normalized-id)>/<source-sha256>.eml`. Verify the digest on read. Retrying an upload of identical bytes is safe; a different digest for the same normalized identity is retained as error provenance and requires reconciliation rather than silently replacing the authoritative source.
- Store a bounded normalized envelope and attachment manifest in Postgres, but no attachment base64. Core and artifact workers must be able to reconstruct work from the staged MIME without provider access.
- Insert the inbox row and mark the ingress `staged` only after the object write succeeds. If object upload succeeds and the DB write crashes, deterministic upload makes retry safe; lifecycle cleanup for unreferenced objects can be added later.

Advancing a provider cursor means “all messages before this cursor have durable ingress/source state,” not “a Redis push happened.” Cursor updates and the relevant staging state should share a Postgres transaction where the cursor is in Postgres. Never advance a batch cursor past a message whose source could not be staged.

## Redis ACK, lease, fencing, and reclaim behavior

Keep Redis transport at least once, but make every transport mutation owner-fenced.

- Version queue payloads. V2 payloads contain `workType` (`stage_ingress`, `process_inbox`, `process_artifact`, `publish_outbox`), tenant, durable record ID, job ID, and attempt metadata. They do not contain MIME or attachment content.
- Generate a `claimToken` per Redis claim and store it in the inflight hash. Replace ACK, fail/retry, defer, renew, and reclaim multi-command sequences with Lua operations that compare job ID plus claim token before mutating the processing list, inflight hash, and lease sorted set.
- Add `renewUnifiedInboundEmailQueueClaim`. Run it on a heartbeat and renew the corresponding Postgres lease with its own token/version. If either ownership check is lost, stop before any fenced terminal write.
- Set the default Redis claim TTL to 120 seconds, retain the 90-second handler timeout, heartbeat every 30 seconds, and validate at startup that claim TTL is at least handler timeout plus one heartbeat interval. Configuration that recreates the current 60/90 mismatch must fail fast.
- Replace the non-cancelling timeout-only outcome with cooperative cancellation (`AbortSignal`) for provider/object operations. Correctness still relies on the final Postgres fencing predicate because JavaScript cancellation is best effort.
- Add an explicit `defer` operation for a wake-up that finds a valid Postgres lease. It atomically moves the job to a delayed sorted set until the DB lease expiry and does not increment the domain attempt count or ACK it as successful. A queue pump moves due delayed jobs to ready.
- ACK only after (a) the core/source/artifact/outbox transaction commits a terminal state, or (b) a terminal durable state is read and its stored result returned. An ACK from a stale claim token is a logged no-op.
- On retryable failure, persist the durable row's error/backoff first, then owner-fenced release the Redis job. If release is lost, Redis reclaim or the Postgres sweeper recreates the wake-up.
- Reclaim expired Redis claims atomically in Lua. Reclaiming Redis does not grant domain ownership; the next handler must still claim/reclaim the Postgres row.

The required crash outcomes follow:

- Crash before core commit: Postgres rolls back all core/effect/outbox writes; expiry makes the inbox reclaimable.
- Crash after commit before ACK: redelivery reads the terminal inbox and returns the same IDs without new effects.
- Worker exceeds a Redis lease: heartbeat normally prevents reclaim; if it does not, Redis may redeliver but the inbox lock/fence/effect constraints permit only one core commit.
- A timed-out old worker that continues running cannot terminal-write with a superseded DB token. If it is already inside the short row-locked transaction, a competing reclaim waits and then observes either its full commit or rollback.

## Artifact handling

Core success creates deterministic `inbound_email_artifacts` manifests; it does not upload attachments while holding the core transaction.

Artifact workers read the staged MIME, not the provider, and process one manifest at a time. Each claim is fenced. Upload with a deterministic storage key/content digest, then insert `external_files`, `documents`, the ticket association, and the artifact terminal update in one tenant-colocated transaction. If storage succeeds but the DB transaction fails, retry reuses the deterministic object; it must not generate another file/document for an already successful artifact row.

Mirror the final result into `email_processed_attachments` for compatibility. Do not let a mirror failure change the core or artifact result; repair it from the artifact ledger. Embedded-image comment rewriting must be an idempotent artifact follow-up and must never create another comment. An attachment can be `terminal_failed` while the inbox remains `succeeded`.

## Transactional outbox handling

The outbox publisher implements the existing event-publisher interface but only inserts rows through the supplied transaction. It creates the same semantic events/channels as `WorkflowEventPublisher`, including suppression of the new-ticket first-comment email, while assigning deterministic `event_key` values.

The dispatcher:

1. Claims one due outbox row with token/version fencing; do not hold a DB transaction while talking to Redis.
2. Publishes through `@alga-psa/event-bus` with `outbox_id` as caller-supplied event ID/idempotency key.
3. Marks the row `published` with the fencing predicate, or records retryable failure/backoff.
4. Relies on touched notification consumers to dedupe the stable event ID for ambiguous crash-after-publish retries.

The existing event bus currently generates its own UUID and can swallow Redis publication errors internally. Add a strict dispatcher-only publish option that preserves the supplied event ID and propagates an unsuccessful stream write so the outbox row is not falsely marked `published`. Keep existing best-effort behavior for unrelated callers.

Repeated delivery of a terminal inbox row cannot insert another outbox row because `(tenant, inbox_id, event_key)` is unique. Outbox publication failure cannot roll back or recreate the ticket/comment.

Use the outbox/reconciliation machinery to mirror terminal inbox outcomes into `email_processed_messages`. Do not write the legacy audit table inside the core transaction: it is an existing compatibility table with separate Citus history, and mixing it into the new distributed/colocated correctness transaction would add migration risk. Reporting may be briefly eventual, but the mirror is retryable and repairable.

## Compatibility, backfill, and rollout

### Preserve legacy audit surfaces

Do not drop, rename, truncate, or redefine the primary key/status meanings of `email_processed_messages`. Existing reporting in `packages/reporting/src/actions/helpdeskReportActions.ts` and older processing code continue to read it. New durable processing mirrors these terminal values:

- inbox `succeeded` -> audit `success` with `ticket_id` and metadata containing `inboxId`, `commentId`, outcome, attempts, and source digest;
- intentional inbox `skipped` -> audit `skipped` with the rule/reason;
- retryable/terminal failure -> audit `failed` or `partial` according to current diagnostics compatibility, while authoritative retryability remains in the inbox;
- never mirror an active durable claim as a terminal success.

Also retain `email_processed_attachments` as described above. Removal or reporting cutover of either legacy table is a later project.

### Backfill/reconciliation

Do not bulk-copy local legacy tables into distributed tables inside the schema migration. Add a resumable, per-tenant, bounded backfill job with a checkpoint and `ON CONFLICT` identities.

For each legacy `email_processed_messages` row:

1. Normalize its stored `message_id` without inventing a new identity. Preserve the old value in provenance.
2. Reconcile `ticket_id`, ticket `email_metadata`, and comment `metadata.email.messageId`. Exactly one match is linked through `inbound_email_effects`; multiple conflicting matches are terminal/alerted and never trigger a third entity.
3. Map legacy `skipped` to a terminal skipped inbox. Map legacy `success` to `succeeded` only when its ticket and comment can both be reconciled unambiguously; otherwise import it as `terminal_failed` with the legacy result preserved for review, never create a guessed missing effect. These rows may have `source_staged_at = NULL` with `legacy_imported = true` because they are not replayable; schema checks allow missing ingress/source only for terminal legacy rows.
4. Map stale `processing` to `retryable_failed` after reconciliation, preserving `processed_at`, error metadata, and an incremented recovery attempt. If legacy metadata contains a usable pointer, create ingress work so the source can be staged. Without a source or pointer, mark `terminal_failed` rather than creating from incomplete data.
5. Treat legacy `failed`/`partial` as retryable only when a source/pointer and retry policy allow it; otherwise import them as terminal failures. Do not broaden retries until the effect ledger and reconciliation pass are deployed.
6. Never delete or overwrite the legacy audit row. Backfill updates only new ledgers and a separate checkpoint.

### Deployment phases

Use a temporary `UNIFIED_INBOUND_EMAIL_DURABLE_MODE=off|shadow|enforce` cutover setting.

1. **Schema/off:** deploy additive tables, repositories, queue-token fencing, metrics, and compatibility readers. Legacy effects remain authoritative; no new schema is removed on rollback.
2. **Shadow staging:** producers persist ingress/source and the backfill reconciles effects, but the durable processor does not create core entities. Compare source-stage coverage, identities, and reconciliation ambiguity against legacy audit results.
3. **Containment before retry:** deploy the effect uniqueness guard/reconciliation and the fenced Redis TTL/heartbeat changes. Until then, do not broadly requeue stale legacy `processing` rows.
4. **Enforce:** drain/restart old email-service consumers, switch producers to V2 durable wake-ups, and make the inbox authoritative. The V2 consumer can convert a remaining V1 pointer into ingress work; old consumers must never receive V2 keys, so use separate V2 Redis keys during the mixed-version window.
5. **Compatibility period:** dual-mirror legacy audit tables, run the sweeper/backfill, and alert on divergence. Remove the temporary mode only after no old consumer version and no unreconciled V1 queue backlog remain.

## Recovery and scheduling

Add an `inbound-email-recovery` maintenance job, scoped per tenant, at a one-minute cadence. Its bounded batches enqueue due `received`, due `retryable_failed`, and expired `processing` rows from ingress/inbox/artifact/outbox tables. Enqueue is idempotent enough to tolerate duplicate wake-ups because Postgres claims remain authoritative.

Register it in `server/src/lib/jobs/registerAllHandlers.ts`, the legacy scheduler adapter in `server/src/lib/jobs/index.ts`, and CE per-tenant scheduling in `server/src/lib/jobs/initializeScheduledJobs.ts`. Add it to the EE maintenance fanout list in `ee/temporal-workflows/src/schedules/setupSchedules.ts`; the existing Temporal maintenance fanout can continue forwarding the server-local job per tenant.

Emit metrics/logs for stale/expired claims, reclaim outcomes, attempts, terminal failures, source-stage latency/failure, legacy mirror lag, backfill ambiguity, outbox age, artifact failures, Redis stale-token mutations, and DLQ growth. Alert on stale `processing`, sustained reclaim rate, oldest pending outbox/source, and repeated email-service heap exits. Heap diagnosis/mitigation remains separate from the correctness implementation.

## Ordered file-level implementation plan

1. **Create schema.** Add `server/migrations/20260807xxxxxx_create_inbound_email_durable_inbox.cjs` with the five tables, checks/indexes/FKs above, parent-first `ensureTenantDistribution`, and non-transactional Citus configuration. Add tenant metadata entries in `packages/db/src/lib/tenantTableMetadata.ts` and tenant-isolation/migration tests. The migration does not alter or drop either legacy audit table.
2. **Define contracts and normalization.** Extend `shared/interfaces/inbound-email.interfaces.ts` with V2 work/disposition/result types and durable record shapes. Add `shared/services/email/inboundEmailIdentity.ts` for the one normalization algorithm and deterministic ingress/artifact/event keys.
3. **Add persistence/state services.** Add `shared/services/email/inboundEmailDurableStore.ts` with tenant-scoped upsert, claim, renew, reclaim, transition, terminal lookup, effect insertion/reconciliation, and bounded due-row scans. Keep all state changes token/version-fenced and expose transaction-scoped variants.
4. **Stage provider sources.** Add `shared/services/email/inboundEmailSourceStager.ts` using the existing Gmail/Microsoft adapters and storage factory. Refactor the provider-fetch portions of `shared/services/email/unifiedInboundEmailQueueJobProcessor.ts` into staging, including Google fanout, and verify digest on processing reads.
5. **Change producers before cursor advancement.** Update `packages/integrations/src/webhooks/email/imap.ts`, `packages/integrations/src/webhooks/email/handlers/microsoftWebhookHandler.ts`, `packages/integrations/src/webhooks/email/handlers/googleWebhookHandler.ts`, and `shared/services/email/EmailWebhookMaintenanceService.ts` to persist ingress before queue handoff. Update `services/email-service/src/emailService.ts` so IMAP stages its already-fetched MIME before `recordLastProcessedMessageId`/folder cursor advancement. Preserve current retryable webhook responses when the durable handoff cannot be recorded.
6. **Fence Redis transport.** Update `shared/services/email/unifiedInboundEmailQueue.ts` with V2/separate keys, claim tokens, heartbeat, delayed defer, and atomic Lua ACK/fail/reclaim operations. Update `shared/services/email/unifiedInboundEmailQueueConsumer.ts` for cooperative cancellation, heartbeat lifecycle, startup TTL validation, and explicit `ack|retry|defer` dispositions. Keep V1 conversion only in the V2 consumer during rollout.
7. **Split prepare from commit.** Refactor `shared/services/email/processInboundEmailInApp.ts` so provider/object/parse/routing work prepares a command without writes and all required new-ticket/reply domain writes accept one transaction. Move current JSON dedupe calls behind a reconciliation-only interface.
8. **Make helpers transaction-aware.** Extend `createTicketFromEmail`, `createCommentFromEmail`, reopen/activity, and required watch-list helpers in `shared/workflow/actions/emailWorkflowActions.ts` to accept an existing transaction and injected adapters. Reuse `TicketModel`'s existing transaction parameter. When the transactional outbox adapter is injected, an outbox insert failure must propagate and roll back rather than being swallowed by the helpers' current best-effort event catches; existing non-inbound callers retain the current helper defaults.
9. **Commit core effects atomically.** Add the fenced transaction orchestrator to `unifiedInboundEmailQueueJobProcessor.ts` (or a focused `inboundEmailCoreProcessor.ts` called from it). Lock the inbox, invoke both helpers on one transaction, insert effect/outbox rows, and terminal-update the inbox. ACK only from the resulting durable disposition.
10. **Add outbox publication.** Add `shared/workflow/adapters/inboundEmailOutboxEventPublisher.ts` and `shared/services/email/inboundEmailOutboxDispatcher.ts`. Narrowly extend `packages/event-bus/src/publishers/index.ts` and `packages/event-bus/src/eventBus.ts` to accept a stable caller event ID and a strict error-propagation mode for the dispatcher. Add stable-ID dedupe at the touched notification consumers; do not redesign unrelated event-bus traffic.
11. **Move artifacts to resumable work.** Refactor `shared/services/email/processInboundEmailArtifacts.ts` to create/process `inbound_email_artifacts` from staged MIME, use deterministic object keys, and fence retries. Preserve the existing `email_processed_attachments` mirror and make embedded-comment rewrites idempotent.
12. **Add recovery/backfill/audit mirror.** Add a focused handler under `server/src/lib/jobs/handlers/` for per-tenant due-row sweeps, legacy backfill/reconciliation checkpoints, and compatibility mirroring. Wire it through `registerAllHandlers.ts`, `jobs/index.ts`, `initializeScheduledJobs.ts`, and the EE Temporal maintenance schedule.
13. **Update diagnostics/report compatibility.** Keep `packages/reporting/src/actions/helpdeskReportActions.ts` on the legacy table during the compatibility period. Add inbox/outbox/artifact diagnostic queries without changing existing report semantics, plus divergence/staleness metrics and alerts.
14. **Cut over in phases.** Deploy schema/off, shadow source staging, reconcile/backfill, validate Citus and divergence, then drain old consumers and enable the V2 queue/enforce mode. Retain all durable rows and legacy audit data through the compatibility window.

## Behavioral test plan

Tests must exercise runtime behavior and real database constraints; source-string assertions are not sufficient.

Add a DB-backed suite such as `server/src/test/integration/inboundEmailDurableInbox.integration.test.ts` and extend the existing queue/provider suites.

1. **Crash after inbox claim, before core writes:** claim and terminate the worker; after lease expiry/replay, assert one ticket, one initial comment, two effect rows, one terminal inbox result, and stable IDs.
2. **Crash after ticket insert, before transaction commit:** inject a failure between ticket and comment; assert the ticket, comment, effects, and outbox all roll back. Replay creates exactly one complete result.
3. **Crash after commit, before Redis ACK:** commit then suppress ACK; redelivery returns the stored ticket/comment IDs and inserts no new entity/effect/outbox/artifact rows.
4. **Concurrent same identity:** run two independent workers for the same `(tenant, provider, normalized message)` using real Postgres. Assert one inbox, one ticket, one comment, and one row per effect type; the loser observes/defer-then-reads the terminal outcome.
5. **Processing exceeds the old lease:** block work past 60 seconds (with test clocks), exercise heartbeat and forced Redis reclaim, and assert no concurrent core effect. Also prove a stale token cannot ACK, fail, renew, or terminal-write a newer claim.
6. **Repeated terminal replay:** replay a successful message multiple times; assert stable entity IDs, one artifact manifest per deterministic key, one outbox row per event key, and one notification consumer effect per stable event ID.
7. **Attachment failure:** make one object upload fail after core commit; assert the ticket/comment stay terminal-successful, only that artifact becomes retryable, and retry produces one file/document/association without recreating core effects.
8. **Outbox failure:** make event publication fail, then recover; assert the pending row later publishes with the same event ID, the consumer applies it once, and the ticket/comment are not recreated. Add the ambiguous publish-then-crash case to verify stable-ID consumer dedupe.
9. **Provider disappears after staging:** stage raw MIME, remove/provider-fail the backing message, and assert core plus artifact processing succeeds entirely from object storage.
10. **New-ticket and reply paths:** exercise both. A duplicate new message creates at most one ticket and one initial comment; a duplicate reply creates no ticket and at most one reply comment on the target ticket.
11. **Intentional rule skip:** assert `skipped` is terminal, stores its reason, creates no effects/outbox/artifacts, and repeated delivery ACKs by reading that result.
12. **Stale legacy processing recovery:** seed a legacy `processing` audit row, optionally seed its already-created ticket/comment, run backfill/reconciliation and reclaim, and assert audit history/error provenance/attempt counts are preserved with no duplicate. Cover missing source and ambiguous entity matches as terminal failures.
13. **Source-stage atomicity/cursors:** for IMAP, Google, and Microsoft reconciliation, fail object storage or inbox insert and assert the corresponding cursor does not advance past the message. Retry stages once and then advances. Google fanout dedupes individual inbox identities.
14. **Queue durability:** delete or lose Redis wake-ups, run the per-tenant sweeper, and assert due Postgres rows are re-enqueued. A live lease is deferred without domain-attempt inflation; expired work is reclaimed atomically.
15. **Citus/schema behavior:** migrate a real Postgres database and the available Citus test environment. Assert every new PK/unique includes tenant, tables are colocated, composite FKs work, duplicate identities/effects/event keys fail within one tenant but the same provider/message value is valid in another tenant, and the core transaction touches only colocated tables.
16. **Compatibility mirror/backfill:** assert terminal inbox/artifact states eventually reproduce existing audit/report values, mirror retries repair a missed write, and neither backfill nor rollback deletes/modifies legacy rows.

Extend these existing suites where their scope fits:

- `shared/services/email/__tests__/unifiedInboundEmailQueue.test.ts` for Lua token/renew/defer/reclaim behavior.
- `shared/services/email/__tests__/unifiedInboundEmailQueueConsumer.test.ts` for dispositions, heartbeat, timeout, and stale ACK behavior.
- `server/src/test/unit/unifiedInboundEmailQueueJobProcessor.fetch.test.ts` for source staging/fanout and provider-unavailable behavior.
- `server/src/test/integration/inboundEmailInApp.webhooks.integration.test.ts` for producer handoff, cursor ordering, new-ticket, reply, and rule-skip flows.
- `shared/services/email/__tests__/processInboundEmailInApp*.test.ts` for prepare/commit decisions and artifact manifest generation.

Run focused Vitest suites, the DB-backed integration target used by the server package, shared/server typechecks, and a migration up/down check on plain Postgres. Treat Citus migration/transaction validation as a release gate, not an optional source inspection.

## Deliberate non-goals

- Do not promise globally exactly-once execution across Redis, Postgres, object storage, provider APIs, and event consumers. Transport and outbox delivery remain at least once; stable IDs and database/consumer guards make effects idempotent.
- Do not solve the email-service heap-growth/root-cause incident here. Continue investigating it independently; more memory is only containment.
- Do not keep a database transaction open during provider fetch, MIME parsing, object upload, attachment work, or Redis publication.
- Do not make Redis locks/leases the domain correctness boundary.
- Do not redesign all event-bus consumers. Add caller-supplied IDs and dedupe only to the inbound-email notification paths touched by this work.
- Do not delete or replace `email_processed_messages` or `email_processed_attachments`, and do not cut reporting over to the new tables in this project.
- Do not automatically retry ambiguous legacy rows, messages lacking a recoverable source, or terminal failures. Preserve and surface them for explicit reconciliation.
- Do not define long-term MIME retention, legal hold, customer export, or purge UX. A secure default retention/encryption/access-control policy is required for launch, but broader records-management product work is separate.
- Do not make attachment success part of ticket/comment atomicity. Artifact failure remains independently retryable.
- Do not clean deterministic but unreferenced source objects in the first correctness cut; record and measure them for a later lifecycle job.

## Risks and mitigations

- **Mixed-version workers can split authority.** Use separate V2 Redis keys, shadow mode, explicit drain/restart, and block enforce mode while an old consumer is present.
- **Citus rejects a hidden local/distributed write.** Keep the core transaction limited to new colocated ledgers plus existing colocated ticket/comment tables. Mirror legacy audit tables after commit and validate with a real Citus transaction test.
- **Identity normalization can merge or split messages incorrectly.** Use one shared function, retain original IDs, test provider-specific forms/case/angle brackets/UIDVALIDITY, and terminal-fail conflicting digests rather than overwrite.
- **Raw MIME contains sensitive data and consumes storage.** Use existing tenant-aware storage, non-PII deterministic keys, encryption/access controls, size caps, digest verification, and an explicit initial retention setting. Monitor capacity before enforce mode.
- **Outbox publish has an ambiguous crash window.** Reuse `outbox_id` on every publish and add consumer dedupe. Do not describe the Redis stream itself as exactly once.
- **A JS timeout does not stop underlying work.** Add cooperative aborts, short core transactions, Redis/DB heartbeats, and final fencing predicates; fault-test a late old worker.
- **Backfill JSON reconciliation may find multiple historical entities.** Never guess. Record ambiguity, alert it, and prevent another create.
- **Audit mirrors can lag.** Keep the durable inbox authoritative, retry mirrors from Postgres, expose lag metrics, and leave report semantics unchanged.
- **Sweeper duplication can amplify load.** Use bounded per-tenant batches, due indexes, jitter, and DB conditional claims. Duplicate queue wake-ups are safe.

## Rollback

Rollback is application/configuration rollback, not destructive schema rollback.

1. Stop enforce-mode V2 consumers and switch producers to `shadow` or `off`. Do not drop new tables, delete staged MIME, clear queues, or reset durable statuses.
2. Allow in-flight short transactions to finish, then drain/fence their Redis claims. Pending Postgres work remains available for a corrected forward deployment.
3. Keep the compatibility audit mirror running if safe; legacy reporting remains readable because its tables were never removed. Switching all the way to the legacy core path is an emergency-only choice because it knowingly restores the original loss/duplication risks.
4. Revert event-bus caller-ID support only after no pending inbound outbox row depends on it. Otherwise pause dispatch and preserve rows.
5. A migration `down` may drop only the new empty tables in local/test environments, child-first. Production rollback must leave populated durable tables in place.

Before re-enabling enforce mode, reconcile any core commits made during the transition, replay due durable rows, verify no old worker remains, and confirm source/outbox/backfill lag is within the rollout threshold.
