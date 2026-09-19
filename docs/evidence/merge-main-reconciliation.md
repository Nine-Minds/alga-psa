# Merge `origin/main` into `feature/co-managed-it` — per-file reconciliation record

- Merge base: `9a59114991e1d5051f73dde3f57e11ff882fdaed`
- Branch tip merged from: `cb65a3444d`
- `origin/main` tip merged: `aa124f86da4b24b9a16be62bf1e2d990e6d205b8`
- Divergence: **492 commits on main**, 286 on the branch, 1620 vs 1252 files changed, **111 files changed by both**.
- Textual conflicts: **29 files**.

Companion records, one per delegated cluster:

- `merge-telephony-notifications.md` — telephony availability + notifications realtime.
- `merge-client-portal-visibility.md` — client-portal contact-scoped visibility.
- `merge-ticket-actions.md` — ticket actions, `TicketService`, `TimeEntryService`.

## Why conflict markers were not trusted

A previous merge on this branch, `1064ee7384` (which merged *this same merge
base*, `9a59114991`), was resolved by concatenating both sides and by **keeping
main's guard while dropping main's effect**. That compiles, typechecks and reads
fine. Worse, because main has not touched those regions since, the current merge
produces **no conflict** there and takes the branch side silently — the loss is
permanent and invisible.

So every contested file was reconciled by diffing the three revisions
(`git show <base|HEAD|origin/main>:<path>`) and asking what each side was *for*,
not by reading conflict markers. `scripts/audit-merge-drops.mjs` was written to
find the rest mechanically: it takes the lines one side added between the fork
point and its tip and reports those absent from the merge result.

```
node scripts/audit-merge-drops.mjs --added-by 9a59114991 --against 0af97e5c61 --result worktree
# fork point 457654d6f0 | 111 contested files | 26 with dropped content
```

Most of the 26 are deliberate branch replacements (`persistCommentPublication` →
`retainNativeConversationEvent`, `dispatchCommentPublication`, the retired
credentials release flag). Three were **accidental drops from `1064ee7384`, all
repaired in this merge**:

| File | What main added and the botched merge dropped | Consequence | Repair |
|---|---|---|---|
| `server/src/middleware.ts` | `exactApiKeySkipPaths.includes(pathname) \|\|` — the **use** of an allowlist whose declaration was kept | The Level.io webhook allowlist silently allowlisted nothing; dead array. Two assertions in `middleware.apiKeyAuth.test.ts` were red. | Clause restored; 17/17 pass. |
| `server/src/middleware.ts` | `pathname === '/api/ticket-comment-attachments/download' \|\|` | The route **exists on this branch** (`server/src/app/api/ticket-comment-attachments/download/route.ts`) but every request to it 401ed in middleware before its in-handler session auth ran. | Clause restored. |
| `server/src/lib/api/schemas/timeSheet.ts` | `is_all_day: z.boolean().optional()` on `baseScheduleEntrySchema` | `is_all_day` was stripped from create/update schedule-entry API payloads while the response schema still declared it required. | Field restored. |

Both `middleware.ts` clauses were **added by main** (`8afaa04dff`,
`efe5e98139`) and absent from the branch parent `0af97e5c61` — the branch never
made a decision about them, so restoring is not overriding a branch choice.

One reported row is a false positive: `contractLineDisambiguation.ts`'s
`if (typeof clientId !== 'string' || ...) return []` guard was legitimately
**relocated** by the branch when the query moved to
`packages/scheduling/src/lib/timeContractCandidates.ts` — except that the guard
did not move with it. It has been added at the query's new home, where it covers
every caller. The tool compares per file, so a relocated line still reads as
missing; that is expected for a review list.

## Conflicted files — which side won and why

| File | Branch wanted | Main wanted | Resolution |
|---|---|---|---|
| `tools/i18n/{es,fr,pt}/glossary.json` | new glossary terms | new glossary terms | **Both**, re-sorted case-insensitively to match surrounding order. |
| `packages/notifications/package.json` | `@alga-psa/tickets` dep | `@alga-psa/tenancy` dep | **Both**. |
| `ee/temporal-workflows/package.json` | `@alga-psa/co-managed` dep | `sharp ^0.35.4`, `ws >=8.21.0` | **Both**; took main's security bumps. |
| `shared/package.json` | `./lib/commentAudience`, `@alga-psa/licensing` | `./lib/quoteTerms`, `@alga-psa/formatting` | **Both** (additive). |
| `shared/tsup.config.ts` | branch's `lib/*` entries | `lib/quoteTerms` | **Both** (additive). |
| `packages/types/src/constants/index.ts` | `./productCapabilities` | `./billingJobNames` | **Both**. |
| `packages/storage/src/StorageService.ts` (uploadStream) | `createTenantKnex` + `assertUploadAdmission` + `validateFileConfig` | `validateUpload(options.origin, …)` | **Both**: kept the branch's admission check and took main's `validateUpload`, which *wraps* `validateFileConfig` with origin handling. This is exactly the shape main's own merged `uploadFile` body uses. |
| `packages/storage/src/StorageService.ts` (uploadFile opts) | `persistRelatedRecords` | `origin` | **Both**. |
| `packages/billing/.../billingEngine.ts` | `joinTimeEntryBillingWorkContext` replacing the `project_*`/`tickets` LEFT JOIN chain | `joinEffectiveServicePrice({…})` replacing the `service_prices as sp` join | **Both.** Main's pricing refactor kept at all 6 sites (verified: 6 `joinEffectiveServicePrice`, 0 `service_prices as sp`, matching main exactly), branch's unioned `billing_work` subquery kept at both sites. Main's re-added `project_*` joins dropped — the branch's subquery resolves the same columns and additionally covers retained co-managed work references. Comment left at the site. |
| `packages/jobs/.../maintenanceJobFanout.ts` | `includeSuspended` + `tenantsWithTeamsMaintenance` | 3 new 3CX job entries | **Both.** Main did *not* change the Teams entry (identical at base and main); it conflicted only by adjacency. |
| `ee/temporal-workflows/.../setupSchedules.ts` | 4 co-managed schedules | contract-cadence replenishment schedule | **Both**. |
| `server/.../servicePeriodFirstBillingPlan.contract.test.ts` | co-managed allowlist entries | replenishment allowlist entries | **Both**. |
| `packages/clients/.../InteractionDetails.tsx` | `artifact.download_url ??` fallback to `/api/documents/…/download` | transcripts open at `/msp/documents?doc=` | **Both, main's target.** Kept the branch's `download_url` precedence (co-managed artifacts carry an access-checked URL) but took main's document-viewer route as the fallback — main's commits `51cfb0eef9`/`d3829b0548` deliberately moved transcripts out of a raw download. |
| `server/.../pushNotifications/*` | `sendPushNotifications` returns `NotificationDeliveryResult` (retryable classification) | returns `PushSendResult[]` (per-device outcomes) | **Genuine incompatibility, reconciled.** Main added `/api/v1/mobile/push-token/test/route.ts`, which does not exist on the branch and calls `sent.find(...)`; the branch's return type has no `.find`, so a naive merge leaves that new route broken at runtime. Introduced `PushSendOutcome { delivery, results }` so the dispatcher gets its retry classification and the test endpoint gets per-device detail from one send. Also kept main's `ExpoUnreachable: <message>` diagnostics and the dispatcher's skip log. Both sides' tests updated; **33/33 pass**. |
| `package-lock.json` | — | — | Took main's lockfile as the base, then `npm install --package-lock-only`. Verified all five contested workspace deps are present. |

## Post-merge verification

- `middleware.apiKeyAuth.test.ts` — 17/17.
- `push-notifications/` — 33/33 across 5 files.
- Attachment-security regression tests and the broad suites: see `docs/evidence/co-managed-suite-results.md`.

## Known deliberate behavioural downgrade to main (needs a human decision)

The branch replaced `persistCommentPublication` with
`retainNativeConversationEvent`, making native PSA comment publication
**best-effort-after-commit rather than crash-durable** the way main's is. This is
branch design, not a merge accident — `scripts/audit-merge-drops.mjs` reports it
across `ticketActions.ts`, `optimizedTicketActions.ts`, `commentActions.ts`,
`TicketService.ts` and `publishScheduledCommentHandler.ts`, consistently. A
reviewer must consciously accept it. See `draftSummary` and the review guide's
blocker section.

---

# Post-merge re-audit (mitigation round)

The audit above was run mid-resolution. This section re-runs it over the
**final** merge result, in the direction that matters for this branch — what
`origin/main` added since the merge base that the result no longer contains —
and dispositions every row. `origin/main` was re-fetched first and had **not**
advanced: it is still `aa124f86da`, so `MERGE_HEAD` is the current tip and no
second merge was needed.

```
node scripts/audit-merge-drops.mjs --added-by origin/main --against HEAD --result worktree
fork point 9a59114991 | 122 contested files | 15 with dropped content
```

Every row below was dispositioned by diffing the three revisions, never by the
absence of a conflict marker.

| # | File | Reported missing | Disposition |
|---|---|---|---|
| 1 | `packages/tickets/src/lib/clientPortalVisibility.server.ts` | 29/29 | **False positive — relocation.** The package file is a one-line re-export shim; the implementation is `shared/lib/tickets/`. `diff origin/main:<pkg file> shared/lib/tickets/clientPortalVisibility.server.ts` is exactly the branch's `{ lock }` option and two comments. |
| 2 | `packages/tickets/src/lib/clientPortalVisibility.ts` | 19/19 | **False positive — relocation.** `diff` against main's implementation is **empty**: the shared copy is byte-identical to main. |
| 3 | `hocuspocus/NotificationExtension.js` | 5/5 | **Deliberate replacement.** Main wrote the ring into `doc.getMap('incomingCall')`; the branch relays it via `broadcastStateless`, keeping notification rooms payload-free. Both ends line up — server `broadcastStateless` → client `onStateless` → `reduceIncomingCall` (main's fold, retained). `NotificationExtension.test.ts` 8/8. |
| 4 | `packages/notifications/src/hooks/useInternalNotifications.ts` | 6/12 | Same change, client half. `useInternalNotifications.test.tsx` 4/4. |
| 5 | `server/src/lib/api/services/TimeEntryService.ts` | 1/2 | `created.work_date = work_date`. Main's fix **is** present, at `nativeTimeTracking.ts:109` (`clock.work_date = fields.work_date`) with main's comment — the branch moved the timer here. Different text, so the tool flags it. **But see the genuine defect below, which this row led to.** |
| 6 | `server/src/lib/productSurfaceRegistry.ts` | 2/6 | **False positive.** The branch adds a `co_managed:` key to every entry, changing the line text. All **18** of main's groups are present and **all 16** with an `algadesk` behavior keep it unchanged; the branch is a strict superset (25 groups). Verified by set-diff, not by eye. |
| 7 | `packages/integrations/src/lib/telephonyAvailability.ts` | 1/31 | **Deliberate strengthening.** `resolveTelephonyAvailability(input)` → `await getTelephonyAvailability(input)` so product admission outranks commercial tier, with the rationale in a comment at the site. |
| 8–11 | `pushNotifications/*`, `expoPushService*`, `optimizedTicketActions.ts` | 1–3 lines each | Reconciled as recorded above (`PushSendOutcome`) or superseded by a richer branch loop. **212/212** pass across `push-notifications`, `internal-notifications`, `hocuspocus` and `ticketCommentScheduling.contract`. |
| 12 | `ee/temporal-workflows/package.json` | 1/17 | **False positive.** `"ws": ">=8.21.0"` **is** present; the branch added a dependency after it, so the line gained a trailing comma. Main's `sharp` and `ws` bumps are both in place, in `dependencies` and in `overrides`. |
| 13 | `package-lock.json` | 28/968 | **Real, and repaired.** See below. |
| 14–15 | `client-tickets.visibility.test.ts`, `telephonyAvailability.test.ts` | 1–2 lines | Test-side counterparts of rows 3/4 and the `isTransaction` fix already recorded. 20/20 and green. |

## The one real drop: `package-lock.json` `libc` metadata

Sixteen `@img/sharp-*` entries had lost their `"libc": ["glibc"|"musl"]` field.
All sixteen packages were still present at **identical versions** and differed
from main in nothing but that field — it was stripped by the local npm when the
lockfile was regenerated, not by a resolution change.

It is not cosmetic. `libc` is how npm picks the glibc build over the musl build
for the same `os`/`cpu`; without it an Alpine image can resolve the glibc binary
and fail at load. Restored verbatim from main for exactly those sixteen entries
(48 added lines, no other change, lockfile re-parsed to confirm validity). The
re-run audit now reports **14** files, with `package-lock.json` gone from the list.

## Historically-preserved drift — the verdict asked for

- **`package-lock.json`** — *not* subsumed; repaired as above.
- **exec bit on `packages/migration-cli/bin/alga-migrate.mjs`** — **subsumed**.
  The index records `100755` and `git ls-tree origin/main` also records `100755`,
  so main now carries the same mode and there is no drift left to preserve.

## A genuine defect the audit led to, which the audit did not itself name

Row 5 sent me to main's regression test for that fix,
`server/src/test/integration/api/timeEntryWorkDateResponse.integration.test.ts`
(main commit `ce042cf434`, "Preserve time-entry calendar dates across API
response paths"). It **failed 3/3 on the merged tree**, and once its fixture was
brought up to the branch's stricter contract it exposed a real day-shift bug:

```
AssertionError: expected '2026-09-17' to be '2026-09-18'
```

Under `TZ=Pacific/Auckland` a timer started on the 18th read back as the 17th.
`presentClock` (`nativeTimeTracking.ts:80`) and `nativeTimeRead.ts:53` both
converted a pg-hydrated DATE with `toISOString().slice(0, 10)`. pg's date parser
builds a Date at **local** midnight, so that conversion is correct only for
UTC and negative offsets and silently loses a day for every positive one. Main's
fix survived on the write path and was missing on the read path.

Fixed by routing both sites through `toCalendarDateString`, the helper that
already existed in `@alga-psa/core` and is used 111 times elsewhere in the repo —
re-exported through `@alga-psa/db` so `packages/co-managed` and `server` reach
the one implementation instead of open-coding the conversion a third and fourth
time. The same open-coded conversion in `TimeEntryService` (`assertTimeSheetPeriod`,
`stopTimeTracking`) went the same way, and `presentAdmittedTime` — which returns
an `INSERT … RETURNING *` row directly and so never passes through the SQL
`to_char` projection — now projects `work_date` too.

**Mutation evidence:** the failure above *is* the mutation test. Before the fix
the assertion reports `'2026-09-17'`; after it, 3/3 pass.

### Why the test was failing before the date bug could even be reached

Worth recording, because it is branch-contract information a reviewer needs:

1. `timeActor` requires `apiKeyId` and a matching resolved `user`. Legitimate —
   the only caller is `ApiTimeEntryController`, whose context comes from
   `buildAuthenticatedApiContext` and always carries both.
2. `lockCoManagedLocalAuthentication` re-locks a live `api_keys` row.
3. The timer admits its source, so the actor needs a role. A role-less user is
   denied before any date logic runs.
4. `{ work_item_type: 'ad_hoc' }` with **no** `work_item_id` is no longer
   accepted. `ad_hoc` names a `schedule_entries` row; a work-item-less timer is
   expressed as `non_billable_category`, which `nativeTimeEntryAccess.ts:162`
   handles explicitly. Main's service validated none of this and simply inserted
   an incoherent row, which is why main's fixture got away with it.

The fixture now supplies a real API key, an MSP `Admin` role, and a real
assigned schedule entry. That is a test correction, not a product concession:
each of the four gates is reachable only through shapes production cannot produce.

## Three more drops the tool structurally cannot see

`scripts/audit-merge-drops.mjs` compares *what one side added after the fork
point* against the merge result. Behaviour that existed **before** the fork and
was later removed by the branch is invisible to it, because neither side "added"
those lines in the window it examines. Three such drops were found by other
means in this round, all of the same keep-the-guard-drop-the-effect shape:

| Where | What was dropped | How it was found | Consequence |
|---|---|---|---|
| `packages/tickets/src/models/comment.ts` | All three calls to `reconcileCommentAttachments` (insert, note edit) and `withdrawCommentAttachments` (delete). **The imports were kept.** | `ticketCommentAttachmentsIntegration` scored 47/57 here and 56/56 on pristine `origin/main` | Comments created through `commentActions.addCommentToTicket` never claimed the files their note referenced, and deleting a comment never released its claims — leaving a deleted comment's attachments readable. |
| `server/src/lib/api/services/TimeSheetService.ts` | `is_all_day: data.is_all_day ?? false` on `createScheduleEntry` | Noticed while reconciling the `is_all_day` schema restoration in `timeSheet.ts` | `baseScheduleEntrySchema` accepts `is_all_day`, so the API took the field from the caller and silently created a **timed** entry. The update path still carried it, which is why it was not obvious. |
| `packages/co-managed/src/nativeScheduleCommand.ts` | Never had `is_all_day` in `writable`, and never called `validateAllDayInterval` | Main's `timeSheetServiceAllDayValidation` was red | On co-managed tenants — the ones this feature is for — the native command claims schedule updates, so all-day entries could not be edited and their boundaries were never validated. |

**The lesson for the next merge on this branch:** the drop audit is necessary
but not sufficient. It finds what main added and the branch lost. It cannot find
what the branch quietly stopped calling. The cheap complement is a pristine-tree
run of the suites that cover the area — `git worktree add <rev>` plus
`cp -a --reflink=auto node_modules` into it resolves the relative `@alga-psa/*`
symlinks into that tree and costs about five seconds and no disk, though the
workspace `dist/` directories are gitignored and must be rebuilt there first.

### One reported row that was a stale assertion, not a drop

`coManagedBootstrap`'s "co-managed admins cannot configure Teams or telephony"
asserted against provider id `teams_phone`. The registry id is `teams-phone`, on
both sides. The merge brought main's `requireManageableProvider`, whose registry
lookup rejects an unknown id **before** the product check, so the test was
passing on `Unknown telephony provider` and proving nothing about co-managed
admission. Corrected to the real id; it now fails closed on "not available for
this product", which is the property it exists to check.

## Measured suite baseline, rather than an assumed one

`coManagedBootstrap` at the pre-round commit `cb65a3444d`, reproduced in a
worktree as described above:

```
pre-round  cb65a3444d : 36 failed | 1372 passed (1408)
after merge + round   : 33 failed | 1375 passed (1408)
```

Set-differencing the failure names: **zero failures are new** relative to the
pre-round commit. Four were fixed by the merge and this round, and the telephony
correction above makes a fifth.
