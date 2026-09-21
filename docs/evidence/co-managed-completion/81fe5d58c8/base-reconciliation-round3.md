# Base reconciliation — merge of `origin/main` `2dc8454a4c` (round 3)

Branch `feature/co-managed-it` was 19 behind / 375 ahead of `origin/main` at `023076a648`, and
PR #3363 reported `mergeable=CONFLICTING` / `mergeStateStatus=DIRTY`. Main's 19 commits are the
sync-mode bundle status propagation feature (`33261cd9c5..2dc8454a4c`).

Merge base: `8120314513`. Merge commit: `3026683f9f`.

## The four conflicts

All four sit in ticket-bundle / client-portal code, which is exactly where this branch's co-managed
audience guards and `assertCoManagedOperationalWrite` calls live. **Both sides carried real effects
in every one**, so none was resolved by taking a side.

| File | Branch side | Main side | Resolution |
|---|---|---|---|
| `BentoTimelineTile.tsx` | audience-correct actor via `ticketActivityAttribution()` | `actor_display_name` + a `TICKET_BUNDLE_STATUS_PROPAGATED` label block | branch's actor line **and** main's label block |
| `client-tickets.ts` | `recordCoManagedTicketResolution` / `recordCoManagedTicketReopened` | `revertBundlePropagationForChild` for a reopened bundled child | both, in the same transaction |
| `ticketBundleUtils.ts` | `assertCoManagedOperationalWrite`, `recordCoManagedTicketReopened` imports | `registerAfterCommit`, `uuid` imports | union of both import sets |
| `optimizedTicketActions.ts` | inline child-propagation loop carrying seven co-managed behaviours | loop replaced by the `propagateBundleMasterStatus` engine + ledger | main's engine call, with the branch's per-child effects ported **into** the engine |

### Why the fourth was not a choice between sides

The merge base had a simple bulk-update loop. The branch had grown seven behaviours on it
(collaborator authority refusal, board-scoped status validation, per-child close-rule enforcement,
co-managed resolution/reopen bookkeeping, per-child `CLOSED`/`REOPENED` activity rows, resource
reassignment, `response_state` clearing and system-actor attribution). Main had replaced the whole
loop with an engine carrying boundary/ledger/confirmation semantics.

Taking main's side alone drops all seven branch behaviours; taking the branch's side alone drops
main's entire ledger feature. So the branch's effects moved into `propagateBundleMasterStatus`,
which is now the single owner of child writes — a caller can no longer reach the children without
them. Guard ordering is preserved: `assertCoManagedOperationalWrite` runs *before* the propagation
preview, so a lapsed co-managed tenant is denied before any bundle work is considered.

## Audit results

1. **`scripts/audit-merge-drops.mjs --added-by origin/main --against 023076a648 --result worktree`**
   — 22 contested files, 2 with flagged content, 7 flagged lines total. Every flagged line is one
   this resolution deliberately rewrote (`legacyUpdatedBy`, `propagatedStatusId`, the expanded
   options object). No real drops. *Necessary, not sufficient — it only inspects contested files.*

2. **Byte-identity for files only main touched** — 71 files main touched, 1439 the branch touched,
   49 main-only. All 49 are byte-identical to `origin/main` in the merge result. The single
   exception across the whole main-touched set is `packages/tickets/src/lib/ticketBundlePropagation.ts`,
   whose context/options types this resolution extends (`collaborator`, `actor`, close-rule
   passthrough). This is the check that catches a branch-side deletion of main content, which
   produces no conflict and is otherwise invisible.

3. **Main's new tests** — a merge that passes the branch's tests and fails main's is a failed merge.

   | Suite | Result |
   |---|---|
   | `apiMiddleware.responseHeaders`, `ticketBundlePropagationOpenApi.contract`, `ticketService.bundleParity.contract`, `ticketBundlePropagationCopy.contract` | 4 files / 14 tests passed |
   | `optimizedTicketActions.liveUpdates`, `optimizedTicketActions.tenantScopedAuth.contract` | 2 files / 26 tests passed |
   | `ticketBundleStatusPropagationsTenantDeletionOrder` | 3 tests passed |
   | `TicketDetails.bundlePropagationConfirm` | 1 file passed |
   | branch-side bundle suites (facade, policy, tenant-scoped, picker, mirror-source, quick-view boundary) | 6 files / 13 tests passed |

4. **Repository checks** — `tsc --noEmit` 0 errors (`NODE_OPTIONS=--max-old-space-size=12288`);
   `check:transaction-threading` OK, 727 files, zero violations; `check:dist-resolution` OK, 226
   modules.

5. **Mergeability re-checked at the candidate** — `gh pr view 3363` reports
   `mergeable=MERGEABLE`, `state=OPEN`, `isDraft=false` at head `3026683f9f`.

## What this does NOT establish

- **`ee/mobile` suites were not run locally.** `ee/mobile` dependencies are not installed in this
  checkout, so all 26 mobile test files fail identically on a missing `expo/tsconfig.base` module —
  including files untouched by the merge. Their evidence here is byte-identity to `origin/main`
  (every `ee/mobile` file is in the main-only set and matches exactly) plus the CI run, not a local
  pass. Main's mobile status-picker 409 handling and locale checks are therefore verified by CI only.
- **Integration suites main added** (`ticketBundling`, `autoCloseTickets`, `ticketBundleRestParity`)
  need a database and were left to CI.
- The pre-existing class of silent drop from *earlier* merges on this branch — main content deleted
  in a file main has not touched since that merge base — is not addressed by check 2, which is
  scoped to this merge's base. It remains a standing risk on this branch.

## Integration shard 4 (job `106117870496`)

Died before running a single test. `.github/workflows/integration-tests.yml:145` ran
`sudo apt-get update && sudo apt-get install -y poppler-utils`, and `apt-get update` exited 100
because `packages.microsoft.com` returned HTTP 403 for the Ubuntu noble `InRelease` file.

`poppler-utils` is genuinely required — `invoiceTicketImmutable.integration.test.ts` and
`invoiceTicketProduction.integration.test.ts` shell out to `pdftotext` — so the dependency is kept.
The step now drops the vendor apt sources the runner image ships and we do not control, tolerates a
residual `apt-get update` error (apt still refreshes the repositories it reached), and hard-verifies
with `pdftotext -v`. The install is **not** `|| true`, so a genuinely unavailable tool still fails
the job there rather than surfacing later as an opaque test failure. The identical step at
`citus-migration-smoke.yml:137` got the same repair.

**Not established here:** whether the Repository test inventory job's 78 missing collection records
go to zero. That is downstream of shard 4 collecting, and must be read from that job's own output
rather than assumed from causation. Any residual gap is a separate finding.
