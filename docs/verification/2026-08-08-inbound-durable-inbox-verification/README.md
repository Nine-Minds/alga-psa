# Verification bundle — durable inbound-email inbox (mitigation round)

**Branch/worktree:** `fix/inbound-email-durable-inbox` @ `7c5adef2ee` (this round's
verification run), prior bundle snapshot @ `f4b697d6ee`
**Date:** 2026-08-08 (this round: 2026-08-10)
**Round type:** verifier-timeout mitigation (round 2). The previous
verifier-timeout (`e53d1420`) was recorded as an orchestration failure — the
independent verifier subagent returned without a verdict after its terminal
pane/thread could not be resumed; no substantive code defect was established
(board annotation, 2026-08-08T21:03Z). This round reproduces and times the
full verifier path at current HEAD to prove every step is bounded and exits
cleanly, and refreshes this bundle to match HEAD `f4b697d6ee` (which added four
bracketed-reply threading tests to the durable suite since this bundle's first
commit `7e4f7d7952` at `4c7322a6f7`).

**Spec of record:** `docs/plans/2026-08-07-inbound-email-durable-inbox-plan.md`
(commit `ce7dd8bcc8`). Every "does this truly fail?" judgment below is made
against that plan.

**Where to start:** read this index, then the **Subscriber inventory /
protocol** section and the **Bounded-duplicate statement** section, then spot-
check the focused suite logs under `runs/` and the schema dumps under
`schema/`.

---

## 1. Repo state

Verbatim `git log --oneline main...HEAD` at bundle time:

```
f4b697d6ee fix(inbound-email): normalize reply Message-ID threading and repair reply-event payloads
4c7322a6f7 fix(inbound-email): make consumer delivery idempotency crash-safe via a reservation state machine
2fb075170e fix(inbound-email): resolve all four draft-review blockers
7973a65372 fix(inbound-email): harden durable retry lifecycle, source-cursor safety, and legacy backfill
ee7b0ad270 fix(inbound-email): shadow mode must not lose messages
138d7249dc feat(inbound-email): durable exactly-once inbox processing
ce7dd8bcc8 docs: plan durable inbound email processing
```

Verbatim `git status` at bundle time:

```
On branch fix/inbound-email-durable-inbox
Changes not staged for commit:
  (use "git add <file>..." to update what will be committed)
  (use "git restore <file>..." to discard changes in working directory)
	modified:   package-lock.json

no changes added to commit (use "git add" and/or "git commit -a")
```

`package-lock.json` shows exactly one pre-existing unstaged modification. It
predates this card, was never staged or committed, and is not part of this
bundle. The bundle commit below stages only `docs/verification/...`.

The approved plan is present on the branch:

```
$ git log main..HEAD --name-only -- docs/plans/
commit ce7dd8bcc8cf37a0dfee3ce2929fdcef94c80af1
Author: Robert Isaacs <robert@nineminds.com>
Date:   Fri Aug 7 18:07:25 2026 -0400

    docs: plan durable inbound email processing

docs/plans/2026-08-07-inbound-email-durable-inbox-plan.md
```

---

## 2. Subscriber inventory — every inbound-outbox consumer, with protocol

The durable outbox emits `TICKET_CREATED`, `TICKET_ASSIGNED`,
`TICKET_UPDATED`, `TICKET_CLOSED`, `TICKET_COMMENT_ADDED` (the
`INBOUND_OUTBOX_EVENT_TYPES` set in
`shared/services/email/inboundEmailConsumerDedupe.ts:59`). Each notification
consumer that may receive those events is wrapped in a DB delivery ledger.
There are two protocols; both live in
`shared/services/email/inboundEmailConsumerDedupe.ts`:

- **Transactional exactly-once** — `handleTransactionalOutboxDelivery`
  (`internalNotificationSubscriber.ts:2997`) runs reserve + effect +
  `delivered` mark in ONE Postgres transaction (`withTransaction` frame at
  `:3039`, reserve at `:3040`, effect at `:3061`, completion at `:3062`). A
  crash before commit rolls back the reservation and the effect together, so
  nothing is acknowledged on the strength of an incomplete reservation.
- **Fenced at-least-once (bounded duplicate window)** — `withInboundOutboxDelivery`
  (`inboundEmailConsumerDedupe.ts:241`) runs fenced reservation (committed
  `delivering` + token + lease) → effect → fenced `delivered` mark. A crash
  between reservation and completion leaves an expired reclaimable
  reservation; redelivery retries the effect. The attempt cap
  (`getDurableMaxAttempts()`) dead-letters a poisoned effect.

| Consumer id (constant) | Ledger consumer value | Wrapper | Protocol | Source anchor |
| --- | --- | --- | --- | --- |
| `INBOUND_OUTBOX_NOTIFICATION_CONSUMER` | `internal-notification` | `handleTransactionalOutboxDelivery` | transactional exactly-once | `server/src/lib/eventBus/subscribers/internalNotificationSubscriber.ts:26` (constant), `:2997` (wrapper) |
| `INBOUND_OUTBOX_EMAIL_CONSUMER` | `ticket-email` | `withInboundOutboxDelivery` | fenced at-least-once (email send) | `server/src/lib/eventBus/subscribers/ticketEmailSubscriber.ts:49` (constant), `:3389` (wrapper) |
| `INBOUND_OUTBOX_WEBHOOK_CONSUMER` | `webhook` | `withInboundOutboxDelivery` | fenced at-least-once (webhook enqueue) | `server/src/lib/eventBus/subscribers/webhookSubscriber.ts:21` (constant), `:103` (wrapper) |
| `INBOUND_OUTBOX_SLA_CONSUMER` | `sla` | `withSlaInboundOutboxEffect` → `withInboundOutboxDelivery` | fenced at-least-once (DB writes via own connection; first-response/resolution writes are idempotent) | `server/src/lib/eventBus/subscribers/slaSubscriber.ts:50` (constant), `:74` (wrapper); rationale comment `:52`–`:62` |
| `INBOUND_OUTBOX_SURVEY_CONSUMER` | `survey` | `withSurveyInboundOutboxEffect` → `withInboundOutboxDelivery` | fenced at-least-once (survey invitation send) | `server/src/lib/eventBus/subscribers/surveySubscriber.ts:16` (constant), `:35` (wrapper) |
| `INBOUND_OUTBOX_RMM_ALERT_CONSUMER` | `rmm-alert-ticket-closed` | `withInboundOutboxDelivery` | fenced at-least-once (RMM alert reset) | `server/src/lib/eventBus/subscribers/rmmAlertTicketClosedSubscriber.ts:24` (constant), `:67` (wrapper) |
| `INBOUND_OUTBOX_SEARCH_INDEX_CONSUMER` | `search-index` | `withInboundOutboxDelivery` | fenced at-least-once (search upsert; re-indexing idempotent) | `server/src/lib/eventBus/subscribers/searchIndexSubscriber.ts:17` (constant), `:441` (wrapper); rationale `:434`–`:437` |

Why SLA and search-index are fenced rather than transactional even though they
write to Postgres: their write path opens its own tenant connection
(`createTenantKnex`/`runWithTenant`) instead of running inside the caller's
transaction, so the ledger treats them as lease/fenced consumers
(`slaSubscriber.ts:52`–`:62`, `searchIndexSubscriber.ts:434`–`:437`). The only
consumer that runs its effect inside the ledger transaction is
`internal-notification`, which is why it is the only exactly-once one.

Non-outbox events pass through the wrappers untouched; a ledger outage fails
open (deliver) so a transient DB error can never suppress a notification
(`inboundEmailConsumerDedupe.ts:112`–`:147`, `:269`–`:274`).

---

## 3. Behavioral evidence

All assertions below are copied verbatim from the DB-backed integration suite
`server/src/test/integration/inboundEmailDurableInbox.integration.test.ts`
(39 tests) and, where noted, the stub-driven subscriber suite
`server/src/test/integration/internal-notifications/eventSubscribers.integration.test.ts`
(15 tests). Full raw output is in `runs/durable-suite.txt` and
`runs/subscriber-suite.txt`. Line anchors refer to the test file at HEAD
`f4b697d6ee`.

### 3.1 Crash before core effect → replay creates exactly one ticket/comment

`it('crash after inbox claim before core writes: replay creates exactly one ticket + comment')`
(`:440`). Worker A claims the inbox row then "crashes" (lease expired via
`lease_expires_at = now() - interval '5 minutes'`); worker B replays:

```
expect(claim.claimed).toBe(true);
...
expect(result.disposition).toBe('ack');
expect(result.outcome).toBe('created');
expect(await countTicketsByMessageId(messageId)).toBe(1);
expect(await countCommentsByMessageId(messageId)).toBe(1);
...
expect(Number(effects?.count)).toBe(2);
...
expect(inbox.status).toBe('succeeded');
expect(inbox.outcome_kind).toBe('created');
expect(inbox.lease_token).toBeNull();
```

Plus the mid-transaction crash variant, where the ticket insert commits but the
whole transaction rolls back before `comment`:

`it('crash after ticket insert before commit: everything rolls back, replay completes once')`
(`:480`) — `withAdminTransaction(...)` writes ticket + comment through the
injected `InboundEmailOutboxEventPublisher`, then `throw new Error('simulated
crash before commit')`:

```
expect(await countTicketsByMessageId(messageId)).toBe(0);
expect(await countCommentsByMessageId(messageId)).toBe(0);
expect(await countRows('inbound_email_effects')).toBe(0);
expect(await countRows('inbound_email_outbox')).toBe(0);
```
then after expiry + replay: `expect(result.outcome).toBe('created')`,
`expect(await countTicketsByMessageId(messageId)).toBe(1)`,
`expect(await countCommentsByMessageId(messageId)).toBe(1)`,
`expect(await countRows('inbound_email_effects')).toBe(2)`.

### 3.2 Crash after effect but before completion/ACK → redelivery returns stored outcome, no duplicate

`it('crash after commit before ACK: redelivery returns stored IDs without new effects')`
(`:554`):

```
const second = await processInbox(inboxId, 'redelivery-worker');
expect(second.disposition).toBe('ack');
expect(second.ticketId).toBe(ticketId);
expect(second.commentId).toBe(commentId);
expect(await countTicketsByMessageId(messageId)).toBe(1);
expect(await countCommentsByMessageId(messageId)).toBe(1);
expect(await countRows('inbound_email_effects')).toBe(2);
```

Consumer-side equivalents (reservation + delivery-ledger crash windows):
- `it('crash after reservation before effect: redelivery reclaims the expired reservation and the effect is produced exactly once')` (`:2020`) — expired `delivering` reservation is reclaimed on redelivery (`expect(redelivery.decision).toBe('deliver')`, `expect(redelivery.token).not.toBe(crashed.token)`), completes once, then `again.decision` is `'skip'`; ledger converges to a single `delivered` row.
- `it('crash after effect before completion mark: non-transactional redelivery retries and converges to delivered')` (`:2090`) — effect ran, mark never landed; retry delivers, 3 further redeliveries all `skip`, one `delivered` row.
- `it('transactional consumer crash before commit rolls back reservation and effect; redelivery produces the effect once')` (`:2155`) — reserve inside `withAdminTransaction` then throw; `countRows(...,'internal-notification')` is `0` after rollback; a fresh reservation + completion lands exactly one `delivered` row.

### 3.3 Expired reservation / lease reclaim (inbox, ingress, outbox, artifact)

- **Inbox (core):** `it('a superseded zombie worker cannot create core effects inside the fenced transaction')` (`:1289`) — zombie token cannot `lockInboxForUpdate` (`rejects.toThrow('inbox_fence_superseded')`), no ticket/effect rows; a new worker reclaims and completes exactly once; the zombie's `transitionInbox` with the old token returns `false`.
- **Ingress (staging):** `it('a crashed ingress claim (expired staging) is reclaimed by the sweeper, not stranded')` (`:1597`) — `findDueIngress` sees the expired `staging` row, the sweeper enqueues `stage_ingress`, `reclaimIngress` installs a new token, and the crashed worker's `transitionIngress` returns `false`.
- **Outbox (publishing):** `it('a crashed outbox claim (expired publishing) is reclaimed by the dispatcher and publishes exactly once')` (`:1679`) — `findDueOutbox` sees expired `publishing`, sweeper enqueues `publish_outbox`, a new dispatcher publishes the SAME `outbox_id` (`eventId: outboxId, strict: true`) exactly once, and `reclaimOutboxRow` on the terminal row returns `{ claimed: false, reason: 'terminal' }`.
- **Artifact:** `it('a crashed artifact claim (expired processing) is reclaimed by the sweeper and completes exactly once')` (`:1750`) — same pattern; expired `processing` is seen due, re-enqueued, reclaimed with a new token, completes once, and `reclaimArtifact` on the terminal row returns `reason: 'terminal'`.

### 3.4 Duplicate/redelivery of terminal rows → stable entity IDs

`it('repeated terminal replay')` is covered across the suite:
- `crash after commit before ACK` (3.2) asserts the same `ticketId`/`commentId` on redelivery.
- `it('intentional rule skip is terminal, stores reason, and creates no effects')` (`:937`) — `dup` delivery returns `ack` with `outcome: 'skipped'`, no effects/outbox/artifacts/tickets.
- `it('exhausted retries dead-letter to terminal_failed instead of looping forever')` (`:1341`) — repeated delivery of a `terminal_failed` inbox returns `ack`/`terminal_failed`, no tickets/effects.
- `it('double-published outbox event is deduplicated by the DB delivery ledger (consumer idempotency)')` (`:1928`) — after reclaim + re-publish with the same `outbox_id`, the consumer ledger yields one `delivered` row (`expect(ledgerRows).toHaveLength(1)`) and a second reservation `skip`s; a different consumer is independently claimable.
- `it('plain duplicate and concurrent delivery yield exactly one delivered ledger row')` (`:2224`) — 3 concurrent reservations: exactly one winner, loser reason `in_progress`; sequential duplicate refused with `already_delivered`; one `delivered` row.

### 3.5 Stale fencing token rejection (superseded writer cannot commit)

- `it('stale fencing token cannot terminal-write a superseded claim')` (`:606`) — an `intruder` owner cannot `transitionInbox` with the current token; after reclaim installs a new token, the old owner's write returns `false`.
- `it('stale fencing token cannot write completion for a superseded reservation')` (`:2276`) — worker A reserves, B reclaims after expiry; A's `completeInboundOutboxEventDelivery` returns `false`; B completes with its own token; single `delivered` row with `lease_token` null.

### 3.6 Forced recovery republish (sweeper + event-bus force flag, `republish_outbox_event`)

- The sweeper scans the delivery ledger (`findRecoverableInboundEventDeliveries`,
  `inboundEmailRecovery.ts:160`) and enqueues `workType: 'republish_outbox_event'`
  per distinct outbox row (`inboundEmailRecovery.ts:169`–`:176`); the V2
  processor routes it to `processInboundOutboxRepublishJob`
  (`unifiedInboundEmailQueueJobProcessorV2.ts:57`, `:101`), which re-publishes
  with the same stable `eventId: row.outbox_id` plus `force: true`
  (`inboundEmailOutboxDispatcher.ts:179`–`:183`).
- The event-bus `force` flag bypasses the per-event/per-handler processed Redis
  sets (`packages/event-bus/src/eventBus.ts` `forceRedelivery` at `:501`,
  `markEventProcessed` guarded at `:534`; `force: '1'` field written at
  `:864`), so an already-`published` outbox row's incomplete consumer deliveries
  are re-driven deterministically. Each consumer's ledger reclaims its own
  expired reservation or skips if already `delivered`.
- Test: `it('recovery sweeper re-publishes incomplete consumer deliveries and dead-letters over-cap failures')` (`:2344`) — an expired `sla` reservation and a due `survey` retryable produce `expect(result.enqueued.deliveries).toBe(1)`; five `recordInboundOutboxEventDeliveryFailure` calls for `ticket-email` drive it over the attempt cap and it dead-letters (`terminal_failed`).
- Consumer-side reclaim on redelivery is covered by the tests in 3.2 and by `it('retryable failure is reclaimed when due and the attempt cap dead-letters a poisoned consumer delivery')` (`:2420`) — `failInboundOutboxEventForConsumer` returns `'retryable'` with `attempt_count` 1 and `next_attempt_at` set; not-due redelivery is `skip`; a due retry increments the attempt counter; a poisoned `webhook` effect loop dead-letters to `terminal_failed`.

### 3.7 Legacy-backfill old-row handling + idempotent rerun

- `it('legacy stuck-processing reconciliation links a pre-existing ticket/comment without duplicating')` (`:1474`) — a legacy `processing` audit row whose ticket+comment already exist imports as `succeeded`/`reconciled` with `legacy_imported = true` and exactly two effect rows; the audit row is preserved (`processing_status` still `'processing'`).
- `it('legacy stuck-processing with no entities and no pointer dead-letters as terminal_failed')` (`:1558`) — `terminal_failed` with `legacy_processing_unrecoverable`, no effects, audit row untouched.
- `it('legacy stuck-processing with a usable pointer becomes retryable via durable ingress work')` (`:1643`) — creates a `received` ingress row and enqueues `stage_ingress`; no terminal inbox written.
- `it('legacy backfill is resumable: interrupted batches converge to the uninterrupted final state')` (`:2537`) — 6 seeded legacy rows (2 reconcilable processing, 1 skipped, 1 unrecoverable processing, 2 failed/partial); run with `limit: 2`, snapshot, resume with `limit: 50`:
  - the interrupted batch's rows are UNCHANGED in the final state (`expect(finalInterruptedSubset).toEqual(afterInterrupt.inbox)`),
  - every legacy row classifies exactly once (`inboxRows` count 6, `effectRows` count 4),
  - no identity appears twice,
  - a third run is a pure no-op (`expect(thirdRun.imported).toBe(0)`),
  - legacy audit rows are never modified or deleted (`expect(legacy.processing_status).toBe(row.status)`).

### 3.8 Reply threading: bracketed In-Reply-To/References resolve the existing ticket

Added at HEAD `f4b697d6ee` after the live smoke (2026-08-08) confirmed a
standards-compliant bracketed reply created a duplicate ticket. The durable
inbox stores `email_metadata.messageId` in the normalized (unbracketed) form,
so a bracketed reply looked up verbatim and missed. The fix exports
`normalizeRfc822MessageId` (`shared/services/email/inboundEmailIdentity.ts`)
and applies it to every stored message-id key and every lookup;
`findTicketByOriginalMessageId` matches BOTH the canonical normalized form and
the raw bracketed form (legacy rows) across `messageId`/`inReplyTo` equality
and `references` JSON containment.

- `it('bracketed In-Reply-To and bracketed References replies resolve the existing ticket (no second ticket)')` (`:732`) — a bracketed `In-Reply-To` reply and a bracketed-`References`-only reply both append a comment to the original ticket; `countTicketsByMessageId` stays 1.
- `it('replay of a threaded reply is idempotent: stable IDs, one comment, no new outbox rows')` (`:792`) — redelivery of a threaded reply returns the stored `ticketId`/`commentId`, one comment total, and the outbox dedupe key prevents a second outbox row.
- `it('reply event outbox payload is schema-valid and the dispatcher publishes it (never dead-letters)')` (`:832`) — the `INBOUND_EMAIL_REPLY_RECEIVED` outbox payload validates against `inboundEmailReplyReceivedEventPayloadSchema` (tenantId/occurredAt required, bare `from`/`to` addresses; `to` falls back to the provider mailbox when empty) and the dispatcher drives the row to `published`.
- `it('bracketed reply resolves a legacy ticket whose email_metadata.messageId kept the bracketed form')` (`:899`) — legacy rows that stored the raw bracketed id are still matched by the two-form lookup.

### 3.9 Reply-event payload schema validation

`buildInboundEmailReplyReceivedPayload`
(`shared/workflow/streams/domainEventBuilders/inboundEmailReplyEventBuilders.ts`)
now requires `tenantId`/`occurredAt`, normalizes `from`/`to` to bare RFC
addresses via `normalizeEmailAddress`, and throws on a missing/empty `to`. The
durable outbox insert validates the payload against the real event schema and
skips-with-warning rather than inserting a doomed `terminal_failed` row (the
pre-fix live failure: payload lacked `tenantId`/`occurredAt` and carried an
invalid recipient; five retries then dead-lettered).

---

## 4. Focused DB-backed suite runs (REQUIRE_DB=1, real Postgres)

Both suites ran from `server/` against `127.0.0.1:5472` with explicit secrets
(`.env.localtest` points at Docker `/run/secrets` paths that do not exist on
this host, so `DB_PASSWORD_ADMIN`/`DB_PASSWORD_SERVER` are injected). The
durable suite drops/recreates + migrates + seeds `test_database` in its
`beforeAll` (`createTestDbConnection`, `server/test-utils/dbConfig.ts`), so the
run also applies every migration through `20260807140000` on a clean database.

Command:

```
DB_HOST=127.0.0.1 DB_PORT=5472 \
DB_PASSWORD_ADMIN=$(cat ../secrets/postgres_password) \
DB_PASSWORD_SERVER=$(cat ../secrets/db_password_server) \
REQUIRE_DB=1 npx vitest run src/test/integration/inboundEmailDurableInbox.integration.test.ts --coverage.enabled=false
```

Exit code: `0`. Result (verbatim, `runs/durable-suite.txt`):

```
 ✓ src/test/integration/inboundEmailDurableInbox.integration.test.ts (39 tests) 11536ms 148 MB heap used
   ✓ Inbound email durable inbox (integration) > sweeper re-enqueues received, due retryable_failed, and expired-processing inbox rows  714ms

 Test Files  1 passed (1)
      Tests  39 passed (39)
   Start at  21:18:23
   Duration  12.28s
```

Wall clock (this run): 12.68s; process exited on its own with code 0 (no
`--forceExit`, no external kill).

Command:

```
DB_HOST=127.0.0.1 DB_PORT=5472 \
DB_PASSWORD_ADMIN=$(cat ../secrets/postgres_password) \
DB_PASSWORD_SERVER=$(cat ../secrets/db_password_server) \
REQUIRE_DB=1 npx vitest run src/test/integration/internal-notifications/eventSubscribers.integration.test.ts --coverage.enabled=false
```

Exit code: `0`. Result (verbatim, `runs/subscriber-suite.txt`):

```
 ✓ src/test/integration/internal-notifications/eventSubscribers.integration.test.ts (15 tests) 2513ms 76 MB heap used

 Test Files  1 passed (1)
      Tests  15 passed (15)
   Start at  21:18:39
   Duration  2.94s
```

Wall clock (this run): 3.38s; process exited on its own with code 0.

Both suites also pass in a single vitest invocation (54/54 in 15.09s wall
clock, exit 0), which is the shape a verifier script can use to bound the whole
focused run to ~15s:

```
DB_HOST=127.0.0.1 DB_PORT=5472 \
DB_PASSWORD_ADMIN=$(cat ../secrets/postgres_password) \
DB_PASSWORD_SERVER=$(cat ../secrets/db_password_server) \
REQUIRE_DB=1 npx vitest run \
  src/test/integration/inboundEmailDurableInbox.integration.test.ts \
  src/test/integration/internal-notifications/eventSubscribers.integration.test.ts \
  --coverage.enabled=false
```

**Why `REQUIRE_DB=1` is mandatory evidence:** without it, `describeWithDb`
(`server/test-utils/requireDb.ts`) silently `describe.skip`s DB-backed suites
with exit 0. With `REQUIRE_DB=1`, an unreachable DB is a hard failure
(`requireDb.ts:43`–`:46`). Negative control — same command with a dead port
(`DB_PORT=5999`), exit code `1`, verbatim `runs/require-db-negative.txt`:

```
Error: REQUIRE_DB=1 but the test database at 127.0.0.1:5999 is unreachable. Refusing to skip DB-backed tests in a required-DB environment.
 ❯ Module.describeWithDb test-utils/requireDb.ts:44:11

 Test Files  1 failed (1)
      Tests  no tests
```

Baseline confirmed: durable **39/39**, subscriber **15/15**, both real exit
code 0 with the guard active.

---

## 5. Typechecks and dependency builds

All commands below produced exit code `0` with zero diagnostics (the `*.txt`
files under `runs/` are empty for the tsc runs; `nx-build-deps.txt` contains
the Nx summary).

| Check | Command (from dir) | Exit | Wall clock |
| --- | --- | --- | --- |
| server | `NODE_OPTIONS=--max-old-space-size=16384 npx tsc --noEmit -p tsconfig.json` (from `server/`) | 0 | 22.09s |
| shared | `npx tsc --noEmit` (from `shared/`) | 0 | 13.88s |
| packages/db | `npx tsc --noEmit` (from `packages/db/`) | 0 | 1.52s |
| packages/event-bus | `npx tsc --noEmit` (from `packages/event-bus/`) | 0 | 1.24s |
| packages/integrations | `npx tsc --noEmit` (from `packages/integrations/`) | 0 | 17.16s |
| services/email-service | `npx tsc --noEmit -p tsconfig.json` (from `services/email-service/`) | 0 | 5.07s |
| services/email-service build | `npm run build` (from `services/email-service/`) | 0 | 8.19s |
| deps build | `npx nx build-deps server` (from repo root) | 0 | 5.87s (cache warm) |

`nx build-deps` summary (verbatim, `runs/nx-build-deps.txt`):

```
 NX   Successfully ran target build-deps for project server and 52 tasks it depends on
```

The full documented verify sequence (server + shared + db + event-bus +
integrations + email-service typechecks, email-service build, `nx build-deps`,
durable suite, subscriber suite) completes in roughly **~90s wall clock** in the
order above — comfortably under the verifier's budget — and every command exits
on its own with code 0. No step waits on a real 120s/90s/30s lease: tests
inject `leaseTtlMs: 30_000` and force expiry via SQL
(`lease_expires_at = now() - interval '5 minutes'`), never by sleeping through
production-scale intervals.

---

## 5.1 Mitigation round (2026-08-10): transactional consumer honesty

Independent PR verification of the prior head found the transactional outbox
**consumer** still had two durability holes: `handleTicketClosed` /
`handleTicketCommentAdded` bypassed the caller-supplied `opts.db` transaction,
and failure-ledger write errors were swallowed, so effects could commit with no
durable ledger row and no retry. This round closes those holes. Evidence in
`runs/*-mitigation-round.txt`:

- **Focused subscriber suite** (`eventSubscribers.integration.test.ts`) — now
  26 tests (15 stub + 11 real-Postgres transactional-delivery tests),
  **26/26 passed**. `runs/subscriber-suite-mitigation-round.txt`.
- **Durable inbound suite** (`inboundEmailDurableInbox.integration.test.ts`) —
  **45/45 passed** (unchanged, no regression). `runs/durable-suite-mitigation-round.txt`.
- **Related contract suites** — `internalNotificationSubscriberTenantScoped`,
  `ticketEmailSubscriber.contactAuthor`, `ticketEmailSubscriber.inlineImageLogging`,
  **3/3 passed**. `runs/contract-suites-mitigation-round.txt`.
- **Mention-notifications integration** (`handleTicketCommentAdded` real path) —
  **2/2 passed**. `runs/mention-notifications-mitigation-round.txt`.
- **All five typechecks** — server, shared, email-service, packages/jobs,
  ee/temporal-workflows, all exit 0. `runs/typechecks-mitigation-round.txt`.

The real-Postgres tests are behavior-level (they drive the actual handlers and
ledger, not stubs) and were verified to fail against the pre-fix behavior by
temporarily reverting each production change (fail-open reserve -> the effect
commits 1 notification with no ledger row; pool-leaking `handleTicketClosed` ->
the notification survives a simulated crash before commit).

---


## 6. Bounded-duplicate statement (external-effect semantics)

Postgres is the exactly-once authority for ticket/comment/effect-ledger/outbox
rows. A provider message may be fetched, queued, reclaimed, and delivered more
than once, but it creates at most one ticket and at most one comment for that
message. This is enforced by:

1. the tenant-first unique `(tenant, provider_id, normalized_message_id)` on
   `inbound_email_inbox` (first serialization point);
2. the locked inbox row plus the `(tenant, provider_id,
   normalized_message_id, effect_type)` PK on `inbound_email_effects` (second
   guard; the losing transaction rolls back all its entity writes);
3. the single short core transaction that writes ticket + comment + effects +
   outbox rows + the terminal inbox update together;
4. the `(tenant, inbox_id, event_key)` unique on `inbound_email_outbox`, so a
   terminal inbox replay cannot insert another logical notification.

External side effects are **fenced at-least-once with a bounded duplicate
window**. Exactly-once external delivery is impossible (a crash between an
effect and its completion mark cannot be distinguished from a crash before the
effect); the delivery ledger (`inbound_email_event_deliveries`, PK
`(tenant, outbox_id, consumer)`) bounds the window and dead-letters poisoned
effects at the attempt cap. The window per subscriber protocol:

| Consumer | Protocol | Duplicate window (external effect) | Why bounded |
| --- | --- | --- | --- |
| `internal-notification` | transactional exactly-once | no window — effect is a DB write inside the ledger transaction | crash before commit rolls back effect + reservation; crash after commit is already `delivered` |
| `ticket-email` | fenced at-least-once | lease TTL 120s default (`getInboundOutboxDeliveryLeaseTtlMs`, `inboundEmailConsumerDedupe.ts:80`) — a crash between send and completion can duplicate at most one email after expiry + reclaim | lease expiry + attempt cap dead-letter |
| `webhook` | fenced at-least-once | same 120s lease window — a crash between enqueue and completion can enqueue the webhook at most once more after reclaim | same |
| `sla` | fenced at-least-once | same lease window; the SLA effect writes are themselves idempotent (first-response/resolution skip when already recorded), so a duplicate is harmless | same |
| `survey` | fenced at-least-once | same lease window — a crash between send and completion can send the survey invitation at most once more | same |
| `rmm-alert-ticket-closed` | fenced at-least-once | same lease window — alert reset can be re-applied at most once more (reset is idempotent) | same |
| `search-index` | fenced at-least-once | same lease window — re-index is an idempotent upsert, duplicate harmless | same |

Recovery after the window: the recovery sweeper (`sweepTenantDurableWork`,
`inboundEmailRecovery.ts:56`) finds expired `delivering` reservations and due
`retryable_failed` deliveries and re-publishes the outbox event with `force`
(`republish_outbox_event`), reclaiming expired reservations rather than
stranding them. In short: **at most one ticket, at most one comment, at most
one outbox row per event key — and for each external effect, exactly-once
delivery except for a bounded lease-TTL window around a crash.**

---

## 7. Citus note — schema-level evidence

Local Postgres is plain **PostgreSQL 15.4** with no Citus extension and no
distributed tables, so `create_distributed_table`/`ensureTenantDistribution`
are no-ops here and schema-level evidence is the bar for the Citus claims
(plan §"Additive schema and Citus constraints").

Postgres version (verbatim):

```
 PostgreSQL 15.4 (Debian 15.4-2.pgdg120+1) on x86_64-pc-linux-gnu
```

`pg_dist_partition` contains zero rows (plain Postgres; the empty stand-in
catalog makes the Citus probe no-op silently — `dbConfig.ts:104`–`:108`).

### 7.1 Tenant-first keys on every `inbound_email_*` table

Every primary key, unique constraint, and unique index includes `tenant`
(verified in the `\d` dumps under `schema/`):

| Table | PK | Uniques |
| --- | --- | --- |
| `inbound_email_ingress` | `(tenant, ingress_id)` | `(tenant, provider_id, ingress_key)` |
| `inbound_email_inbox` | `(tenant, inbox_id)` | `(tenant, provider_id, normalized_message_id)` |
| `inbound_email_effects` | `(tenant, provider_id, normalized_message_id, effect_type)` | `(tenant, inbox_id, effect_type)` |
| `inbound_email_artifacts` | `(tenant, inbox_id, artifact_key)` | — |
| `inbound_email_outbox` | `(tenant, outbox_id)` | `(tenant, inbox_id, event_key)` |
| `inbound_email_event_deliveries` | `(tenant, outbox_id, consumer)` | — |

All cross-table FKs are composite `(tenant, ...)` within the family
(ingress←inbox←effects/artifacts/outbox←event_deliveries); there are no FKs to
`email_providers`, `tickets`, `comments`, files, or documents, so provider or
entity deletion cannot destroy audit history and no deletion-order coupling is
introduced.

### 7.2 `ensureTenantDistribution` with `colocate_with => tenants`

`server/migrations/utils/citusDistribution.cjs:12`–`:16`:

```js
async function ensureTenantDistribution(knex, tableName) {
  if (!(await canCreateDistributedTable(knex))) return;
  if (await isDistributed(knex, tableName)) return;
  await knex.raw(`SELECT create_distributed_table('${tableName}', 'tenant', colocate_with => 'tenants')`);
}
```

Every durable table calls it at the end of its `createTable` block
(`20260807120000_create_inbound_email_durable_inbox.cjs` at `:88`, `:189`,
`:219`, `:281`, `:342`; `20260807130000_create_inbound_email_event_deliveries.cjs:38`;
`20260807140000_evolve_inbound_email_event_deliveries.cjs:104` re-asserts it).
Parents are created and distributed before children, and each migration sets
`exports.config = { transaction: false }` because `create_distributed_table`
cannot run inside a migration transaction (plan-required).

### 7.3 Registration in `packages/db/src/lib/tenantTableMetadata.ts`

All six tables are registered tenant-scoped (`:157`–`:162`):

```
  inbound_email_ingress: { scope: 'tenant' },
  inbound_email_inbox: { scope: 'tenant' },
  inbound_email_effects: { scope: 'tenant' },
  inbound_email_artifacts: { scope: 'tenant' },
  inbound_email_outbox: { scope: 'tenant' },
  inbound_email_event_deliveries: { scope: 'tenant' },
```

### 7.4 Behavior exercised on the local plain-Postgres DB

Because Citus is absent locally, the "same identity valid in another tenant"
and "duplicate identity fails within a tenant" claims are exercised through the
real constraint behavior:

- `it('tenant isolation: same provider+message identity in another tenant creates its own inbox')` (`:984`) — the identical `(provider_id, normalized_message_id)` is inserted in two tenants and both rows exist with distinct `inbox_id`s.
- The within-tenant uniqueness is asserted structurally by the `inbound_email_inbox_identity_unique` constraint in `schema/inbound_email_inbox.dump:38` and behaviorally by the effect-ledger PK in the concurrent test (`:583`).

The migration up/down check is part of the durable suite bootstrap (a clean
`test_database` is dropped, recreated, migrated through `20260807140000`, and
seeded on every run of `runs/durable-suite.txt`).

---

## 8. What this round changed

This mitigation round refreshed the bundle to HEAD `f4b697d6ee`. The four
bracketed-reply/threading tests added since the bundle's first commit
(`7e4f7d7952`) bring the durable suite to 39 tests; all `runs/*.txt` files were
regenerated verbatim at HEAD (durable 39/39, subscriber 15/15, the
`REQUIRE_DB` negative control, all typechecks, `nx build-deps`), and the
behavioral-evidence and typecheck sections now carry the updated counts, line
anchors, and measured wall-clock times.

No product-code files were modified in this round — the branch's code is
unchanged from `f4b697d6ee`. The only unstaged change in the tree remains the
pre-existing `package-lock.json` modification, which is untouched and not
committed.

**Known-open items (not fixed in this round, listed for the reviewer):**

1. **Host-run webhook 404 on `/api/email/webhooks/imap`** — a live POST returns
   404 (observed in the 2026-08-08 smoke). Durable V2 commits but the provider
   cursor fails to advance under the legacy IMAP webhook path. Not the cause of
   this verifier-timeout; tracked separately.
2. **Bracketed-reply duplicate ticket** (e.g. TIC001018→TIC001019) — the
   2026-08-08 smoke reproduced it; HEAD `f4b697d6ee` normalizes reply
   Message-ID threading and adds the 39th durable test asserting the bracketed
   reply resolves the existing ticket. Regression tests are green; a live
   GreenMail re-smoke is still pending.
3. **`INBOUND_EMAIL_REPLY_RECEIVED` payload** — the smoke found it dead-lettered
   after five validation failures (payload lacked `tenantId`/`occurredAt`, invalid
   recipient). Fixed at HEAD by `buildInboundEmailReplyReceivedPayload`
   (schema-valid payload, bare-address normalization, provider-mailbox `to`
   fallback) and by skip-with-warning on outbox insert; covered by the new
   schema-valid-payload test (`:832`). Existing `terminal_failed` reply rows
   stay terminal (no backfill).
