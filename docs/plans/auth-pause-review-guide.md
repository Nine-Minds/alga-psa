# Auth-Pause Draft-Review Guide (bounded verification)

This guide bounds a draft-review pass to **exactly three defect claims and six
regression tests** — the concurrency fixes in commit `2e861ac53b` ("fix(email):
close three concurrency defects in auth-failure auto-pause"). Verification is
**limited to the claims and tests named below. Repository-wide searching,
re-deriving the feature, auditing unrelated diffs, and running broader suites
are out of scope** for this pass.

Companion plan: `docs/plans/2026-08-15-auto-pause-inbound-auth-failures-plan.md`.

## 1. Orient (run these, and only these)

```bash
git status                                  # expect: clean working tree
git log --oneline main..HEAD               # confirm HEAD is 2e861ac53b or a descendant
git diff main...HEAD --stat -- . ':(exclude)package-lock.json'
```

The branch is 6 commits ahead of `main` (`8f0a09cc5d` plan → `ef7bda6be7` feature
→ three hardening fixes → `2e861ac53b`). `package-lock.json` churn is excluded
from review scope by policy; nothing else is excluded. Do not expand the diff
scope beyond these commands.

## 2. The three claims, with their implementing code

Every path below is verified against this tree. Read these functions; do not
grep beyond them.

### Claim 1 — Capped-sweep starvation + pause-snapshot race

The capped sweep excludes paused providers **before** applying the LIMIT
(paused rows can never occupy cap slots), and a failure racing a pause **parks**
the ingress row non-terminal (`retryable_failed`, attempt budget reset to 0,
~30 s backoff) instead of terminalizing it. Parked rows are re-driven by the
first post-resume sweep because they stay due (`next_attempt_at` in the past).

| What | Where |
| --- | --- |
| `sweepTenantDurableWork` — snapshots paused providers, passes them into the due scan, and consumes the guarded dead-letter outcome (`'parked_while_paused'` at line ~96) | `shared/services/email/inboundEmailRecovery.ts:56` (`excludeProviderIds` at :83, over-cap path at :94–95) |
| `findDueIngress` — the exclusion is part of the row-selection predicate (`whereNotIn('provider_id', …)`), applied **before** `.limit()`, so paused rows cannot starve the cap | `shared/services/email/inboundEmailDurableStore.ts:1715` (predicate at :1722–1723) |
| `deadletterIngress` — the over-cap terminal UPDATE is guarded by a NOT EXISTS over the provider's live pause state; when the guard blocks, the row is PARKED (`retryable_failed`, `attempt_count = 0`, `next_attempt_at = now()+30 s`) | `shared/services/email/inboundEmailDurableStore.ts:349` (`PAUSED_DEADLETTER_PARK_BACKOFF_MS = 30_000` at :333, park write at :378–390) |
| `claimIngress` — keeps its early pause read and consumes the guarded outcome | `shared/services/email/inboundEmailDurableStore.ts:162` |
| `parkIngressWhilePaused` — the staging-worker park (same non-terminal semantics) | `shared/services/email/inboundEmailDurableStore.ts:236` |
| Staging worker park path — auth failure against a paused provider parks pre-claim | `shared/services/email/inboundEmailIngressStagingWorker.ts:213` (`PAUSED_INGRESS_PARK_BACKOFF_MS = 30_000` at :53) |

### Claim 2 — Google `history_id` atomicity + monotonicity

`google_email_provider_config.history_id` advances are single-statement
compare-and-set UPDATEs — `(history_id IS NULL OR (history_id ~ <digits> AND
history_id::bigint < candidate::bigint))` — so the comparison happens at the
**persisted** value, not a snapshot read, and a slower stale worker can never
regress the cursor. Both paths:

| Path | Where |
| --- | --- |
| V2 staging worker cursor advance (CAS write) | `shared/services/email/inboundEmailIngressStagingWorker.ts:412` |
| V1 `persistGoogleHistoryCursor` (CAS write, invoked from the job processor) | `shared/services/email/unifiedInboundEmailQueueJobProcessor.ts:688` (predicate at :704, call site at :1043) |
| Fresh-watch baseline persist in `registerWebhookSubscription` — **intentionally authoritative, not monotonic** (a fresh watch's historyId is Gmail's own mailbox snapshot; the inline comment at ~line 317 explains why guarding it would strand a dead cursor) | `shared/services/email/providers/GmailAdapter.ts:207` (write at :332) |

### Claim 3 — Microsoft lock mismatch returns remaining work

A recovery reconcile pass that loses the Graph cursor lock reports
`moreRemaining: true` (renewal passes keep the historical clean-skip), so the
multi-pass auth-pause recovery loop runs another pass from the saved boundary
instead of declaring the paused interval exhausted over messages that were
never handed off. Coverage counts only monotonic markers: non-terminal ingress
rows, settled legacy outcomes, and un-refuted caller-seeded `handedOffIds`.

| What | Where |
| --- | --- |
| `reconcileProviderMessages` — public recovery entry (explicit `since` boundary + `handedOffIds`) | `shared/services/email/EmailWebhookMaintenanceService.ts:606` |
| `reconcileMissedMessages` — the pass itself; lock-mismatch branch returns `moreRemaining: recoveryPass ? true : false` | `shared/services/email/EmailWebhookMaintenanceService.ts:679` (mismatch return at :939; coverage-marker rules documented at :713–731; `reviveTerminal: recoveryPass` at :851) |
| `recoverAuthPausedProvider` — the multi-pass recovery loop that keeps looping while `moreRemaining` and clears the pause only after a completing pass | `shared/services/email/EmailProviderLifecycleService.ts:502` (loop check at :779) |
| `reviveTerminal` handling — a terminally failed ingress is revived and re-handed-off rather than counted covered | `shared/services/email/inboundEmailProducer.ts:102` → `reviveTerminalIngress` at `shared/services/email/inboundEmailDurableStore.ts:276` |

## 3. The six discriminating regression tests

All six were verified to fail against the pre-`2e861ac53b` code (stash-proof
run); each carries its pre-fix failure signal as an assertion in the test, so a
reviewer can confirm the test discriminates by reading the highlighted
"Pre-fix" comments.

| # | Claim | Test (exact name) | File | Pre-fix failure signal |
| --- | --- | --- | --- | --- |
| 1 | Capped-sweep starvation | `sweep starvation: a paused provider's due ingress rows never consume the capped scan window of an unpaused provider` | `server/src/test/integration/inboundEmailDurableInbox.integration.test.ts:1925` | `sweep.enqueued.ingress` was **0** (paused rows filled the cap), must be **3** |
| 2 | Pause-snapshot race | `sweep snapshot race: a provider pausing between the sweep snapshot and the over-cap dead-letter decision is parked, never terminalized` | `server/src/test/integration/inboundEmailDurableInbox.integration.test.ts:1988` | row ended **`terminal_failed`**, must stay parked (`retryable_failed`, `attempt_count` 0) |
| 3 | Google CAS (V2 staging) | `google history cursor advance is an atomic compare-and-set: a slower stale writer cannot overwrite a newer cursor` | `server/src/test/integration/inboundEmailDurableInbox.integration.test.ts:2050` | cursor read back **'1500'** after the stale writer, must be **'9000'** |
| 4 | MS lock mismatch (service) | `microsoft recovery reconcile: a cursor-lock mismatch mid-pass reports remaining work and hands off nothing` | `server/src/test/integration/inboundEmailDurableInbox.integration.test.ts:2128` | mismatch pass returned `moreRemaining` **false**, must be **true** |
| 5 | MS lock mismatch (recovery lifecycle) | `auth-pause recovery survives a mid-recovery cursor-lock race: the pause clears only after a pass completes coverage` | `server/src/test/integration/inboundEmailDurableInbox.integration.test.ts:2187` | recovery "resumed" after **1** listing call, must loop to **2** |
| 6 | Google monotonicity (V1) | `V1 google cursor persist is monotonic at write: a stale pointer job cannot regress the post-watch cursor` | `server/src/test/integration/inboundAuthPauseRecovery.integration.test.ts:549` | cursor regressed to **'1500'**, must stay **'9999'** |

## 4. Running the six tests (the only test command to run)

Run **from the `server/` directory** — vitest file filters are resolved against
the server root, so passing `server/src/...` paths from the repo root yields
"No test files found":

```bash
cd server
NODE_OPTIONS=--max-old-space-size=8192 node_modules/.bin/vitest run \
  --testNamePattern "sweep starvation|sweep snapshot race|google history cursor advance is an atomic|microsoft recovery reconcile: a cursor-lock mismatch|auth-pause recovery survives a mid-recovery|V1 google cursor persist is monotonic" \
  src/test/integration/inboundEmailDurableInbox.integration.test.ts \
  src/test/integration/inboundAuthPauseRecovery.integration.test.ts
```

Expected result: **`2 passed (2)` files, `6 passed | 64 skipped (70)` tests.**

Host notes (this workstation):

- Do **not** use root `npm run test:local` — its `dotenv` CLI bin is absent
  here, so it fails before vitest starts.
- The suites self-wire the database: they load the repo-root `.env.localtest`
  and call `wireLocalTestDbEnv()` (`server/test-utils/dbConfig.ts`) to point at
  the `alga-psa-local-test` Postgres exposed on `localhost:5472`.
- The `alga-psa-local-test` compose stack must be up (Docker on this host
  requires `sg docker -c "..."`; `docker ps | grep local-test` to confirm).
- `NODE_OPTIONS=--max-old-space-size=8192` is required for heavier server
  processes; the six tests themselves run comfortably (~20 s total).

## 5. Verdict criteria

- All six tests pass on the identified HEAD → the three defect claims hold;
  the review verdict for this pass is **pass within scope**.
- Any failure → report the failing test and its observed vs. expected value;
  do not improvise fixes or widen the search in this pass.

Anything not listed above — other features on the branch, UI, billing, other
email paths, dependency hygiene — is out of scope for this review round.
