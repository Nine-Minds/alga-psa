# Merge evidence: ticket actions, TicketService, TimeEntryService

Merge of `origin/main` (`aa124f86da`) into `feature/co-managed-it`.
Merge base: `9a59114991e1d5051f73dde3f57e11ff882fdaed`.

Scope of this document: the four conflicted files listed below, plus two changes
made outside them that this resolution required.

The governing rule for every hunk: a side's *guard* is worthless without its
*effect*. Where the two sides were orthogonal, both effects are kept. Where they
genuinely collided, the choice is recorded with its reason.

---

## `packages/tickets/src/actions/ticketActions.ts`

| Hunk | Branch wanted | Main wanted | Resolution | Verified |
|---|---|---|---|---|
| Import block | `'use server'` plus the co-managed import set (`persistCommentPublication` + `reconcileCommentAttachments`, `publishNativeCommentEvent`/`publishNativeCommentWorkflowEvent`, `assertCoManagedOperationalWrite`, `withCoManagedOperationalTransaction`, `retainCoManagedConversationBeforeSourceChange`, `recordCoManagedTicketResolution`, `recordCoManagedTicketReopened`, `syncCoManagedTicketAwaitingClientSla`) | `'use server'` plus `import type { ContactVisibilityContext } from '../lib/clientPortalVisibility'` and `persistCommentPublication` | **Union.** Branch's `{ persistCommentPublication, reconcileCommentAttachments }` is a superset of main's import from the same module, so main's line collapses into it; main's `ContactVisibilityContext` type import is added verbatim. | `tsc --noEmit` in `packages/tickets` exits **0** |

**The trap that was checked and did not fire.** The brief warned that main's
`ContactVisibilityContext` might be imported into a file from which the branch
had deleted its consumer. Verified it is genuinely live: main replaced base's
`resolveClientSelectedBoardIds` (returns `string[]` of board ids) with
`resolveClientVisibility` (returns the full `ContactVisibilityContext`). The
branch never touched that region, so git auto-merged main's richer version in,
and the merged file uses it at lines 250-259 and at both call sites (1298-1301,
2281-2284), which feed `contactVisibility` into the query builders. Main's
contact-scoped portal visibility is intact; nothing needed restoring.

---

## `packages/tickets/src/actions/optimizedTicketActions.ts`

| Hunk | Branch wanted | Main wanted | Resolution | Verified |
|---|---|---|---|---|
| Import block | Same co-managed set as above, plus `hasCommentCollaborationAttribution`, `prepareTicketResourceReassignment`, `formatCollaborationActorName`, `resolveTicketMutationCollaborator` / `TicketMutationCollaborationContext` | `ContactVisibilityContext` type import + `persistCommentPublication` | **Union**, same collapse as above. `ContactVisibilityContext` is live here too (lines 236-259 and the `contactVisibility` field threaded through the query context at 264-364). | `tsc --noEmit` exits **0** |
| Bundled child propagation | Row-locked per-child loop: `.orderBy('ticket_id').forUpdate().select('*')`, per-child close-rule enforcement, per-child `is_closed`/`closed_at`/`closed_by`/`response_state`, `recordCoManagedTicketResolution`/`recordCoManagedTicketReopened`, CLOSED/REOPENED activity rows, `prepareTicketResourceReassignment`, system-actor handling | Single bulk `UPDATE ... where master_ticket_id = id`, plus **`childPublishes`**: diff each child against `liveUpdateFields` and register one after-commit `publishTicketUpdate` per *changed* child | **Branch's loop kept; main's publish semantics folded in.** See below. | Targeted harness: **T006 and T024 pass**; both **fail** under the branch's original code |

### The bundle hunk in detail

The branch's loop already delivered main's *shape* — a per-child diff and a
per-child `registerAfterCommit(publishTicketUpdate(...))`. It did **not** deliver
main's *semantics*, in one specific and easily-missed way.

`diffTicketFields(currentRow, validatedUpdate)` iterates `Object.keys(validatedUpdate)`
with **no allowlist and no name-based skips** (`packages/tickets/src/lib/liveUpdates.ts:63-78`).
Main knew this, which is why it diffed against `liveUpdateFields` — a snapshot of
`propagateFields` taken *before* `is_closed` is added — and commented:

> `// Live updates diff the user-facing fields only; is_closed mirrors`
> `// status_id and is added to the write below, not to the diff.`

The branch instead diffed against `propagate`, which carries `updated_by`,
`updated_at`, `is_closed`, and (on a close) `closed_at`/`closed_by`/`response_state`.
Because `updated_at` is set to `new Date().toISOString()` on every propagation, it
**always** differs — so every child of a synced bundle would publish a live update
on every master edit, including children whose user-facing fields did not change.
That is precisely "keeping main's guard while dropping main's effect": the
per-child publish loop survives but the *only-changed-children* property it exists
to enforce is destroyed.

Resolution: build the published diff from main's curated set, then add back the
close denormalization that only the branch's per-child loop can compute (main's
single bulk UPDATE had no per-child value for these):

```ts
const childLiveUpdateFields: Record<string, any> = { ...liveUpdateFields };
for (const closeField of ['closed_at', 'closed_by', 'response_state']) {
  if (closeField in propagate) childLiveUpdateFields[closeField] = propagate[closeField];
}
const childUpdatedFields = diffTicketFields(child, childLiveUpdateFields);
```

This is a strict superset of main's published field set and honours main's comment.

**System actors — a documented reasoned choice, not a silent drop.** Main
publishes per-child live updates unconditionally; the branch guards them with
`!isSystemActor`. The branch's guard was kept, because **main itself guards the
master-level publish the same way**, with the comment
`// System closes (auto-close engine) skip the live UI update entirely.`
Publishing child updates for an auto-close whose master update main deliberately
suppressed is incoherent, and main's file has no system-actor concept on the child
path only because that path was bulk, not per-child. *Flagged for human review:
this is the one place the merged behaviour intentionally differs from main.*

Main's `935d229bc1` "fix closed flag for children" is preserved twice over — the
auto-merged `propagateFields.is_closed = !!newStatus?.is_closed` above the loop,
and the branch's per-child `propagate.is_closed = Boolean(newStatus.is_closed)`.

---

## `server/src/lib/api/services/TicketService.ts`

| # | Hunk | Branch wanted | Main wanted | Resolution | Verified |
|---|---|---|---|---|---|
| 1 | Document upload cleanup | Drop the manual unclaimed-storage rollback; `uploadFile(..., persistRelatedRecords)` commits the document row + association inside the upload's own transaction | `documentCommitted = true;` and `await this.persistDocumentPreviews(knex, document, buffer, context.tenant);` | **Both.** Branch's transactional persistence kept; main's **preview generation** carried forward | `ticketDocuments.contract.test.ts` T067 **passes** (7/7 in file) |
| 2 | `withTransaction` destructuring | `await assertCoManagedOperationalWrite(trx, context.tenant)` as the callback's first statement; return `fullTicket` | Return `{ fullTicket, externalLinks }` | **Both** | `ticketExternalLinks.contract.test.ts` passes |
| 3 | Status-change guard | Re-read both status rows inside the `if`, with `.forShare()` row locks | Hoisted `statusChanged` / `nextStatus` / `previousStatus`, **no locks** | **Main's structure + branch's locks** | see below |
| 4 | Status-change effect | Post-UPDATE writes for `is_closed`/`closed_at`/`closed_by` + `Object.assign(ticket, ...)`, then `recordCoManagedTicketResolution` / `recordCoManagedTicketReopened` | Denormalization folded into `updateData` before the single UPDATE (`dcae902f5b`), **co-managed recorders absent** | **Main's fold + branch's recorders** | `ticketServiceCreateUpdateTenantScoped`, `ticketService.bundleParity` pass |
| 5 | Comment publication | `retainNativeConversationEvent(..., { legacyPublish: () => this.safePublishEvent(...) })`; return `{ response }` | **`scheduledPublication`** path arming `SCHEDULED_COMMENT_JOB` after commit; `persistCommentPublication` otherwise; return `{ response, externalLinks }` | **All three paths preserved**; see below | `ticketCommentScheduling.contract.test.ts` **5/5**; integration **+1 test fixed** |

### Hunk 1 — `documentCommitted` was correctly *not* resurrected

Main's `documentCommitted` has exactly one consumer, main's manual rollback at
`if (commentAttachmentDraft && !documentCommitted)`. The branch deleted that
rollback (its `persistRelatedRecords` comment explains why: the rows now commit
inside the upload's own transaction, so a failed upload leaves nothing to delete).
Reviving the flag would have been dead state, so it was dropped — but
`persistDocumentPreviews` is orthogonal to the rollback and was kept.

Placement required one structural change. Main built `const document: IDocument`
at the outer scope; the branch builds it *inside* the `persistRelatedRecords`
callback, where it is unreachable afterwards. A hoisted `let document: IDocument | undefined`
is assigned inside the callback, so previews run on the outer connection **after**
the upload transaction has committed — which is required, since
`persistDocumentPreviews` UPDATEs the `documents` row it needs to already exist.
It swallows and logs its own errors, so it can never undo a durable upload.

### Hunks 3 & 4 — main's structure, but only because the locks came with it

Main's refactor is the better shape: hoisting the status reads lets the
denormalized close fields ride the *same* UPDATE that produces the returned row
(`dcae902f5b` "return denormalized close fields from ticket update"), replacing
the branch's three follow-up writes plus `Object.assign`. It was adopted — but
main's hoisted reads had **no row locks**, so `.forShare()` was restored onto them.
The lock window is now strictly wider than the branch's (taken earlier in the same
transaction, same order), which is safe.

All three required properties hold: **(a)** `forShare()` locks on both status rows;
**(b)** `is_closed`/`closed_at`/`closed_by` denormalization, now folded into the
single UPDATE; **(c)** `recordCoManagedTicketResolution` / `recordCoManagedTicketReopened`,
keyed off the same hoisted, locked rows and still ordered before the `TICKET_CLOSED`
publish.

### Hunk 5 — the same trap, one merge earlier

Investigating this hunk surfaced a defect that **predates this merge**. The merge
base has `persistCommentPublication(trx, ..., publishEvent)` in `addComment`
("Intent is persisted; after-commit dispatch and recurring recovery deliver it").
Branch `HEAD` has no `persistCommentPublication` in `TicketService.ts` at all.
No branch commit removed it — `git log -S persistCommentPublication 9a59114991..HEAD --
server/src/lib/api/services/TicketService.ts` is **empty**, which means it was
dropped inside a merge commit (the botched `1064ee7384`). Branch commit
`bbcb597549` was written against an older parent that still had the pre-base
`safePublishEvent` call, so its `legacyPublish` faithfully preserved *that*; the
botched merge then silently downgraded main's durable publication intent to a
best-effort after-commit publish.

The merged code restores all three paths, ordered by what each mechanism owns:

```ts
const retainedByConversation = scheduledPublication
  ? false
  : await retainNativeConversationEvent(trx, ..., { legacyPublish: async () => {} });
if (scheduledPublication) {            // main's feature: arm the worker after commit
  registerAfterCommit(trx, async () => { ...scheduleBackgroundJobAt(SCHEDULED_COMMENT_JOB, ...)... });
} else if (!retainedByConversation) {  // base/main's durable intent, restored
  await persistCommentPublication(trx, { eventType: 'TICKET_COMMENT_ADDED', payload: eventPayload }, publishEvent);
}
```

Three facts drove this shape:

1. **Retention must be skipped for a scheduled comment**, not merely
   "not published". `retainCoManagedNativeCommentEvent` requires
   `c.publish_state = 'published'` for non-invalidation events
   (`packages/co-managed/src/nativeConversationEvents.ts:30`) and throws
   `'Native conversation event source is unavailable'` otherwise. A scheduled
   comment is `publish_state: 'scheduled'`, so calling retention on it would
   **roll the comment back**. This matches the web composer, which gates its
   native event on `if (!isScheduled)` (`optimizedTicketActions.ts:3519`).
2. **`retainNativeConversationEvent` returns `false` exactly when the tenant has
   no co-managed conversation ownership** (`nativeConversationEvents.ts:25`), and
   registers its own after-commit publish when it does. Passing a no-op
   `legacyPublish` and branching on the return value is what keeps retention and
   `persistCommentPublication` from both publishing.
3. `persistCommentPublication` needs `trx`, so it cannot be the `legacyPublish`
   callback (that runs after commit).

Main's `externalLinks` return and its post-commit `TICKET_EXTERNAL_LINK_ADDED`
loop are preserved verbatim.

---

## `server/src/lib/api/services/TimeEntryService.ts`

| Hunk | Branch wanted | Main wanted | Resolution | Verified |
|---|---|---|---|---|
| `startTimeTracking` | `return this.withTimeErrors(() => startNativeTimeTracking(knex, this.timeActor(context), data));` | The old inline body | **Branch's extracted implementation**, after auditing it against main's only post-base change to that body | `timeEntryServiceTenantScoped.contract.test.ts` passes; `tsc` clean |

Main's only commit touching this file since the merge base is `99d00b9871`
"Fix mobile Start Timer 500: drop to_char from RETURNING". Every behaviour in the
inline body was checked against `startNativeTimeTracking`
(`packages/co-managed/src/nativeTimeTracking.ts:86-106`):

| Inline behaviour | Status in `startNativeTimeTracking` |
|---|---|
| Citus `to_char` in `RETURNING` (the actual 500) | **Already fixed** — uses plain `.returning('*')`, never a raw expression |
| `created.work_date = work_date` calendar-date correctness | **Was missing — ported.** See below |
| duplicate-session `ConflictError` | Equivalent: throws `TIMER_ALREADY_ACTIVE`, mapped by `withTimeErrors` to `ConflictError('An active time tracking session already exists')` |
| `truncateToMinute(new Date())` | Equivalent or better: `now(trx)` is `date_trunc('minute', clock_timestamp())`, truncated in the database; the stop path truncates too |
| `computeWorkDateFields(startTime, userTimeZone)` | Present, spread into the inserted row |
| `assertServiceIdPresent(data.service_id)` | Superset: operational mode is validated by `operationalTimeEntryFields`; commercial mode additionally checks the service exists and is tenant-scoped |
| `recalculateProjectTaskActualHoursForEntryChange` | **Correctly absent.** Main recalculated at *start* because start inserted a real `time_entries` row with a null `end_time`. The extracted design inserts into `native_time_tracking_sessions` instead and creates the `time_entries` row at *stop*, via `service.createAdmitted(...)`. There are no actual hours to recalculate at start |

**Ported (outside the four files):** `packages/co-managed/src/nativeTimeTracking.ts`,
immediately after the insert in `startNativeTimeTracking`:

```ts
clock.work_date = fields.work_date;
```

Without it, `presentClock` falls back to `clock.work_date.toISOString().slice(0, 10)`
on the `Date` that pg hydrates from the `DATE` column in the **Node process**
timezone. That is correct for negative UTC offsets but shifts the day backwards for
positive ones (local midnight `2026-09-18T00:00+02:00` → `2026-09-17T22:00Z` →
`"2026-09-17"`). Overwriting with the timezone-local `'YYYY-MM-DD'` string that
`computeWorkDateFields` already computed is exactly what `99d00b9871` did and is
timezone-independent. `git status --porcelain` on this file was checked first and
showed it clean (not `UU`).

---

## Verification

### Typecheck

| Workspace | Command | Result |
|---|---|---|
| `packages/tickets` | `npx tsc --noEmit` | **exit 0**, 0 errors |
| `server` | `NODE_OPTIONS=--max-old-space-size=12288 npx tsc --noEmit` | 3 errors, **0 in the four files** |

The 3 server errors are in auto-merged files owned by other agents and are
**introduced by this merge** (each side is individually clean). Fixes below, under
"Changes needed in files not owned here".

### Tests

| Suite | Result | Notes |
|---|---|---|
| `server` `src/test/unit/api/` (210 files) | **612 passed / 4 failed** (209 files pass) | All 4 failures in `timeSheetServiceAllDayValidation.test.ts` → `TimeSheetService.ts`, a clean file neither side conflicted; branch commit `6b3bec559e` |
| `packages/tickets` `src/actions src/lib` (70 files) | **478 passed / 19 failed** (66 files pass) | 4 failing files, all proven pre-existing on branch `HEAD` |
| `ticketCommentScheduling.contract.test.ts` | **5 / 5 pass** | One over-specified literal updated; see below |
| `ticketCommentAttachmentsIntegration.test.ts` (real DB) | **47 passed / 10 failed** | Branch `HEAD` scores **46 / 11**. This merge **fixes one test and breaks none** |
| Targeted bundle harness (throwaway) | **T006, T024 pass** | Both **fail** under the branch's original diff basis |

### Proof that the remaining failures pre-date this merge

*`optimizedTicketActions.liveUpdates.test.ts`* — ran the suite against three
sources by temporarily swapping in `git show` blobs of files owned here (restored
immediately; no git state mutated):

| Source | Result |
|---|---|
| merge base `9a59114991` | **15 passed / 0 failed** |
| branch `HEAD`, pre-merge | **2 passed / 13 failed** |
| this resolution | **3 passed / 13 failed** (16 tests — main adds one, and it passes) |

Identical failure signature in both failing runs (11 × `.forShare is not a function`,
1 × `Unexpected table: tenants`, 1 × related). Every stack frame lands on
`optimizedTicketActions.ts:2647` (the master-level status read in
`updateTicketInTransaction`) or `:396` (`syncCoManagedTicketAwaitingClientSla`) —
**branch code outside every hunk resolved here**. Cause: branch commits added
`.forShare()` row locks and `tenants` reads without extending this suite's
hand-rolled knex mock.

*`ticketCommentAttachmentsIntegration.test.ts`* — the test file and both email
subscribers in the failing stack have **zero** `9a59114991..origin/main` commits and
are byte-identical to branch `HEAD` (`git diff HEAD` empty). Swapping `TicketService.ts`
to its branch-`HEAD` blob and re-running gave **11 failed / 46 passed** versus
**10 failed / 47 passed** for this resolution. Diffing the failing test names:

- **Fixed by this resolution:** `REST create, reply and edit use the same persisted attachment lifecycle` — directly attributable to restoring `persistCommentPublication` in hunk 5.
- **Newly broken:** none.
- **Still failing on both (pre-existing):** 10, all `ZodError: timestamp Required` from `coManagedCustomerCommentEmailSubscriber.ts`, branch-only code.

*The other three `packages/tickets` failures* are stale source-text contract
assertions left by branch refactors that moved code into `shared/lib/...`, none of
which read any of the four files:

| Test file | Asserts about | Branch commit that broke it |
|---|---|---|
| `ticketPeripheralTenantScoped.contract.test.ts` | `board-actions/boardActions.ts` | `4e0b35b7d1` |
| `ticketSupportFacade.contract.test.ts` | `lib/responseStateSettings.ts`, `actions/ticketBundleUtils.ts` | `2149a71db6`, `50148971cc` |
| `commentTenantScoped.contract.test.ts` | `lib/clientPortalVisibility.server.ts` (a 1-line shim since `c0c6ff2c22`) | `c0c6ff2c22` |

### Proof that the bundle-hunk fix was necessary

`optimizedTicketActions.liveUpdates.test.ts` T006 and T024 — the two tests that
encode main's per-child publish semantics — cannot run at all on this branch
because of the pre-existing mock gap above. A throwaway harness was built (a copy
of the suite with `forShare`/`forUpdate`/`orderBy`/`select('*')`/two-arg `.where`
and a `tenants` table added to the mock, and `board_id` added to the status
fixture), used, and deleted.

| Child-diff basis | T006 | T024 |
|---|---|---|
| This resolution (`childLiveUpdateFields`) | **pass** | **pass** |
| Branch's original (`diffTicketFields(child, propagate)`) | **fail** | **fail** |

Both counterfactual failures are the predicted symptom:
`expected [ …(3) ] to not include 'alga-psa:ticket-updates:tenant-1:child-2'` —
the *unchanged* child publishing a spurious live update because `updated_at`
always differs. This is the concrete evidence that main's per-child publishing
effect would otherwise have been lost.

---

## Changes made outside the four owned files

Both were checked with `git status --porcelain` first; neither was `UU`.

1. **`packages/co-managed/src/nativeTimeTracking.ts`** (was clean) — one line plus
   comment, `clock.work_date = fields.work_date;`, porting main's `99d00b9871`
   calendar-date fix into the extracted `startNativeTimeTracking`. Rationale above.

2. **`server/src/test/unit/api/ticketCommentScheduling.contract.test.ts`** (`A `,
   added by main's `983479fe34`; the branch never touched it) — one assertion. It
   pinned the raw source text `"} else {\n        await persistCommentPublication(...)"`,
   which cannot survive the co-managed retention gate the merged code needs. The
   assertion's *intent* is preserved and strengthened: it now pins
   `"} else if (!retainedByConversation) {"` before the same
   `persistCommentPublication` call, **and** additionally pins that retention is
   skipped outright for a scheduled comment. The other four assertions in that test
   and all other tests in the file are untouched. **Worth a human glance**, since
   it is main's test being adjusted to the merged shape.

## Changes needed in files not owned here (NOT applied)

These are the 3 remaining `server` typecheck errors. Both are **merge-introduced**:
each side is individually clean and the combination is not.

1. **`server/src/lib/productSurfaceRegistry.ts` lines 167-168** — main added the
   `api_email_templates_psa_only` rule with `{ psa, algadesk }`; the branch widened
   `PRODUCT_CODES` to include `co_managed`. Main's new rule is the only literal in
   the file missing the key. Fix, matching the sibling `api_ticket_psa_only_subroutes`
   entry exactly:
   - `behaviorByProduct: { psa: 'allowed', algadesk: 'denied', co_managed: 'denied' },`
   - `visibleInMetadataByProduct: { psa: true, algadesk: false, co_managed: false },`

2. **`server/src/lib/pushNotifications/pushNotificationDispatcher.ts` line 81** —
   the branch changed the return type to `Promise<NotificationDeliveryResult>`;
   main added a priority-threshold filter whose `eligible.length === 0` branch does
   a bare `return;`, written when the signature was `Promise<void>`. Fix:
   `return { status: 'skipped', reason: 'below_priority_threshold' };`
   It must be `skipped`, not `failed` — `coManagedDeliveryRuntime.ts` would requeue
   a `failed`/retryable result that can never become deliverable.

## Open items for human review

1. **Bundle child publishing for system actors** — the merged code keeps the
   branch's `!isSystemActor` guard, so an auto-close engine run publishes no child
   live updates. Main published them. Reasoning is in the bundle-hunk section; this
   is the one intentional behavioural divergence from main.
2. **The adjusted contract-test assertion** in item 2 above.
3. **Pre-existing branch defect worth its own fix:** `optimizedTicketActions.liveUpdates.test.ts`
   has 13 failing tests because its hand-rolled knex mock lacks `forShare`/`forUpdate`/
   `orderBy`/`select('*')`/two-arg `.where` and a `tenants` table. This blinds the
   suite to T006/T024 — exactly the tests guarding bundle child publishing. The
   harness used above shows the mock changes needed are small.
4. **`persistCommentPublication` was lost in the earlier merge `1064ee7384`**, not
   by any reviewable commit. Worth checking whether that merge dropped other
   main-side effects the same way.
