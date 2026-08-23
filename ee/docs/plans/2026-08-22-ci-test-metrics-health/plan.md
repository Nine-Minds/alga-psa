# CI Test-Metrics Health: Findings & Improvement Plan

**Date:** 2026-08-22
**Scope:** The nightly/PR test pipeline and the shared metrics sheet
(`docs/reference/test-metrics.md`, sheet id `1eKcgRVSwd3bDBSbbwyj-WYb8jhqSEDOG8FPO9--O21M`).
**Sources:** All 5 sheet tabs (1,284 suite runs Jun 12 → Aug 22, 117k coverage rows),
`.github/workflows/integration-tests.yml` / `unit-tests.yml` / `validate-translations.yml`,
`scripts/record-test-metrics.mjs`, `server/vitest.config.ts`, git history, and the
Aug 21/22 nightly run logs (runs 32447991048, 32552410001).

---

## Investigated findings

### F1 — The nightly job is riding its 90-minute timeout (root cause of the fake-green day)

Test execution alone in the shared nightly job (`integration-tests.yml`, one job runs
integration-full then infrastructure-full):

| Date | integ (s) | infra (s) | sum (min) |
|---|---|---|---|
| 08-19 | 3,237 | 1,451 | 78 |
| 08-20 | 3,470 | 1,511 | **83** |
| 08-21 | *cancelled* | 163 | — |
| 08-22 | 3,341 | 1,413 | 79 |

Add ~8–10 min of setup (npm ci, nx builds, migrations) and the job is at the
`timeout-minutes: 90` ceiling. On Aug 21 the integration step was **cancelled by the
timeout**; the infra step still ran under `if: always()`, was interrupted after 163s
(5 executed, 349 "skipped"), and the recorder logged it as **100% pass**. integration-full
got no row at all that day. Both suites grow ~1–2% per day — this recurs without a fix.

### F2 — The recorder reports vacuous greens on partial runs

`record-test-metrics.mjs` computes `pass_pct = passed / (passed + failed)`; skipped tests
are invisible. Three partial runs in the history posted misleading rows:

- 2026-08-21 infrastructure-full: 5/354 executed → recorded **100%**
- 2026-08-13 integration-full: 111/1,564 executed (65s) → recorded 97.3%
- 2026-08-12 integration-full: 377/1,587 executed (466s) → recorded 99.2%

Nothing in the row or the summary tab distinguishes these from real runs.

### F3 — infrastructure-full: 109 stable failures, non-blocking by design

69.21% pass, failure count pinned at 107–109 for 19 straight days — a fixed broken set,
not flakiness. The workflow comment says "non-blocking until it has a green baseline;
flip continue-on-error off once stable." Aug 22 log failure clusters:

| Cluster | ~Count | Signature | Likely fix locus |
|---|---|---|---|
| A. DB connection cascade | ~35 | `Client has encountered a connection error and is not queryable`, `Unable to acquire a connection` — whole files fail (timePeriods 8/8, projectManagement 11) | per-file bootstrap/pool teardown; one shared cause |
| B. Schema drift: `clients.credit_balance` | ~5+ | `column "credit_balance" of relation "clients" does not exist` | tests/helpers not migrated to current schema |
| C. Undefined `invoice_id` from shared helper | ~10 | `Undefined binding(s) … [invoice_id]`, `expected undefined to be 'INV-000001'` | one invoice-generation test helper |
| D. FK cleanup order | ~3 | `delete from "clients" … violates client_billing_profiles FK` | cleanup ordering in teardown |
| E. Assertion drift | ~15 | quote template lists, tax per-item amounts, `expected undefined to be 10000` | individual test updates |
| F. Timeouts | ~5 | 20s/120s timeouts | likely downstream of A |

Top files: projectManagement (11), invoiceNumberGeneration_part2 (9),
billingInvoiceGeneration_tax (9), timePeriods (8), projectPermissions (7),
quoteInfrastructure (7), prepaymentInvoice (7).

### F4 — Coverage history has a deliberate methodology break at 2026-07-31

`experimentalAstAwareRemapping: true` (commit `67b268ca55`, Jul 30) changed the line
denominator ~679k → ~216k (3.15x). Jul 30–31 the sheet interleaves both regimes
(37 runs, main vs. un-rebased branches); all runs after Jul 31 17:46 are the new regime.
The `server/src/lib/mcp` line-count collapse (58,903 → 13) is the `**/*.generated.ts`
exclusion (`0c46063429`, Jul 29) removing the generated MCP registry — intentional and
correct (it had been inflating coverage ~7 points). **No regression here**, but nothing
in the sheet marks the break, so any trendline crossing Jul 31 is wrong.

### F5 — Coverage is 32.38% and overstated; debt is concentrated

- 26% of source files (1,467 of 5,587) are never loaded by the suite, so they're absent
  from the denominator (v8 untested-file crawl never leaves `server/` — documented in
  the recorder). True coverage is lower than headline.
- Trend within the comparable window: 30.49% → 32.38% over 20 days. Healthy direction.
- Three directories hold ~35% of uncovered lines: `packages/billing` (28.2k),
  `server/src/lib/api` (17.0k), `server/src/app` (9.3k). Worst core infra by %:
  `server/src/services` 5.7%, `server/src/lib/eventBus` 8.4%.

### F6 — Healthy subsystems (no action)

- **unit-coverage**: 100% on main, 12,920 tests; sub-100 runs are PR branches — the
  blocking gate works as intended.
- **integration-tier1**: 100% across all 254 runs.
- **i18n validation**: real blocking jobs (glossary audit, template parity); the
  all-zeros record is legitimate post-merge state. 7 locales in lockstep at 29,238 keys.
- **integration-full**: healthy since the Jul 3 repair, but failures crept 0→7 over
  three weeks — watch, don't ignore.

### F7 — Minor: summary tab mixes run vintages

The summary tab pairs 06:04 rows (integration/infra) with 21:38 rows (unit/tier1)
with no staleness indication, and duration growth of tier1 (300s → 1,284s for 731
tests) is out of proportion to its test-count growth.

---

## Plan

### P0 — Stop lying: honest metrics + timeout headroom (small diffs, do first)

1. **Split the infra suite into its own job** in `integration-tests.yml` (own service
   containers, own timeout ~45 min; integration-full keeps ~75 min). This removes the
   shared-fate cancellation (F1) and gives each suite duration headroom independently.
   Cheaper alternative if runner cost matters: keep one job, raise `timeout-minutes`
   to 120 — but the split also isolates infra's pool problems (F3-A) from the
   integration suite, so prefer the split.
2. **Guard recording against partial runs** (`scripts/record-test-metrics.mjs` +
   workflow steps):
   - Give the run steps `id:`s and gate recording on
     `steps.<id>.outcome == 'success' || steps.<id>.outcome == 'failure'`
     (excludes `cancelled`).
   - In the recorder, add an `executed` column (`passed+failed`) and a `run_status`
     column: `complete` when the vitest JSON has no interrupted signal, else `partial`.
     Leave `pass_pct` blank for partial rows so no formula averages them.
   - Existing tabs: append columns at the end; the header-row check already tolerates
     schema growth (new tab creation writes full header).
3. **Add vacuous-green detection to the summary tab**: flag when `executed` <
   80% of the trailing-7-run median for the suite, or duration < 50% of median.
   These two checks would have caught all three bad days in the history.
4. **Backfill honesty**: annotate the three known-partial rows (Aug 12, 13, 21) and
   add a note row/named range marking the 2026-07-31 coverage methodology break (F4).
   Document both in `docs/reference/test-metrics.md`.

**Acceptance:** a cancelled or interrupted run can no longer produce a ≥-pass_pct row;
nightly completes with ≥25 min headroom; summary tab shows staleness/partial flags.

### P1 — Re-green infrastructure-full (the one real red)

Work the clusters in leverage order; each cluster is one PR-sized unit:

1. **Cluster A (connection cascade, ~35 fails + most of F):** reproduce one all-fail
   file locally (`timePeriods.test.ts`) against the CI bootstrap; suspect pool
   destruction in a shared teardown or a bootstrap that dies once and poisons the fork.
   Fixing this alone should cut failures roughly in half.
2. **Cluster C (undefined `invoice_id`, ~10):** trace the shared invoice-generation
   helper; one fix un-fails invoiceNumberGeneration/billingInvoiceGeneration families.
3. **Cluster B (`credit_balance` schema drift, ~5):** migrate tests/helpers to the
   current credit schema (verify actual columns first — see client-terminology memory).
4. **Cluster D (FK cleanup order, ~3):** delete `client_billing_profiles` before
   `clients` in teardown helpers.
5. **Cluster E (assertion drift, ~15):** update expectations file-by-file; treat any
   that expose real product bugs as separate tickets.
6. **Flip `continue-on-error` off** for the infra steps once the suite holds green for
   5 consecutive nightlies — this is the workflow's own stated intent.

**Acceptance:** infrastructure-full ≥99% for 5 consecutive nightlies, then blocking.

### P2 — Coverage integrity and targets

1. **Fix the 26%-unmeasured blind spot:** post-process the coverage summary to add
   0%-line entries for on-disk source files absent from the report (the recorder
   already walks the tree for `files_total` — extend that walk to emit denominator
   lines), OR accept the blind spot but surface `files_measured/files_total` on the
   summary tab so the headline can't be read as complete.
2. **Ratchet, don't target:** add a PR check that fails if lines% drops >0.15pt vs.
   main's latest row (the sheet already has the data; the unit gate is already
   blocking). Avoid fixed % targets — the denominator will move again.
3. **Directed debt paydown** (only if/when capacity exists, in this order):
   `server/src/services` (5.7%, 3.7k lines — small and core),
   `server/src/lib/eventBus` (8.4%), then `packages/billing` by module.

### P3 — Watch items (no immediate work)

- **integration-full drift** 0→7 failures over 3 weeks: if it crosses ~10, treat as P1.
- **tier1 duration** (300s → 1,284s): profile once; likely test-count + bootstrap
  growth, but 4.3x for 731 tests deserves one look.
- **unit-coverage duration** (272s → 1,056s): proportional to 3.2x test growth; fine.

### Sequencing & effort

| Phase | Effort | Dependency |
|---|---|---|
| P0.1–0.2 (job split + recorder guard) | ~half day | none |
| P0.3–0.4 (summary flags + annotations) | ~half day | P0.2 columns |
| P1.1 (connection cascade) | 1–2 days investigation-heavy | P0.1 helps isolate |
| P1.2–1.5 (remaining clusters) | ~2–3 days total | none |
| P1.6 (make blocking) | trivial | 5 green nightlies |
| P2 | 1–2 days | independent |

The single highest-leverage item is **P0.1**: it fixes the fake-green mechanism, the
recurring timeout, and unblocks clean P1 investigation at once.
