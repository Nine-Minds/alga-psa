# Scratchpad — shared contract charge resolution

- Spec situation: no design-session plan for this card on the branch (`git log main..HEAD -- docs/plans/` lists only upstream plans; nothing 2026-10 about charge resolution/simulator/pools). Built from card brief + dossier.
- Ticket alga-2026-0002684 "Internal analysis (2 of 2)" was readable via the Alga API (ticket comments endpoint); root cause matches the card: simulator only prices `Bucket`-typed services; engine reads contract_line_buckets/bucket_usage; resolveBucketForLine drops pooled hours from the hourly query.
- Engine `client_contract_line_id` === `contract_lines.contract_line_id` everywhere (aliased in SQL). Pool identity mismatch is naming only.
- Engine does not exclude usage under pools; only hourly (resolveBucketForLine). Preserved.
- Test DB: `docker` container alga-currency-test-pg on 5472. Run EE integration tests with
  `cd ee/server && TEST_DB_NAME=alga2684_test DB_HOST=127.0.0.1 DB_PORT=5472 npx vitest run --config vitest.integration.config.ts <file>`
- Parity suite: `ee/server/src/__tests__/integration/contractChargeResolutionParity.integration.test.ts`.

## Pool identity fix — evidence
`loadBucketObligation` now queries `contract_line_buckets` by `contractLine.contract_line_id` (was the
`client_contract_line_id` alias, populated from the same column). Full invoice-line dump
(`CHARGE_RESOLUTION_DUMP`) of the parity fixtures before vs after this commit: byte-identical. Conclusion:
the mismatch was naming-only; it changes no live pool charge.

## Resolver + sources — outcome
- Engine and simulator both call `resolveContractLineCharges` (packages/billing/src/lib/billing/chargeResolution). Sources: `DatabaseChargeSource` (engine) and `ScenarioChargeSource` (ee simulator).
- Engine invoice-line dump before/after the engine switch: IDENTICAL.
- Parity pool fixtures were red at a62fafbcb5 (`it.fails`) and are plain `it` and green after the scenario source. Template pool (`contract_template_line_buckets`) test is in contractSimulator.integration.test.ts.
- Remaining `configuration_type` reads in the engine loaders are the stored discriminator of the single config row per (line, service); no precedence/sorting logic remains in either side.
- Open: rollover across periods is in-memory per simulation run; after-hours multiplier is not simulated; usage pooled exclusion exists in neither source; per-entry vs aggregated hour pricing remains an engine/simulator split (LEVERAGE-marked).
- (Superseded) an earlier note blamed sandbox DB credentials for failing suites; see "Test DB credentials" below. All of them pass on both a62fafbcb5 and HEAD once credentials are exported.

## Test DB credentials (sandbox)
Postgres runs in container `alga-currency-test-pg` on 127.0.0.1:5472. Credentials are files under the repo root `secrets/`. Export in the SAME shell command as vitest:
```
export DB_HOST=127.0.0.1 DB_PORT=5472 DB_USER_ADMIN=postgres DB_USER_SERVER=app_user \
  DB_PASSWORD_ADMIN=$(cat secrets/postgres_password) DB_PASSWORD_SERVER=$(cat secrets/db_password_server) \
  TEST_DB_NAME=alga2684_test DB_NAME_SERVER=alga2684_test
cd ee/server && npx vitest run --config vitest.integration.config.ts src/__tests__/integration/contractChargeResolutionParity.integration.test.ts
cd server && npx vitest run src/test/integration/<suite>
```
`taxRateCaps.db` needs an explicitly named test DB (`DB_NAME_SERVER`). Run files one at a time (parallel files on one DB: "Connection terminated"); a second DB name (`alga2684_dev`) can be used to run two things concurrently.

## Review round 2 — evidence
- Parity file: 15 tests. New: fixed in advance; pricing schedule; percentage discount (compared via `result.discounts`, which is where the engine puts discounts; the simulator emits a `discount` line); pool `allow_rollover` across two consecutive periods (live `bucket_usage` rollover = 360 carried minutes, overage 2h vs 8h when rollover is off); several pooled entries; per-entry vs aggregated rounding (KNOWN GAP); absolute-value acceptance (unedited snapshot, 14h assumed, exactly 4 overage hours = 60000, zero plain hourly lines for the pooled service).
- Period alignment: the simulator bills arrears one invoice window after the service period starts, so the scenario horizon starts one period before the engine window (periods[1] = 2025-02-15 window, periods[2] = 2025-03-15 window).
- Red/green at a62fafbcb5 (same file copied into a base worktree): 8 red (all pool-dependent: pool-only, weighted, not exhausted, catch-all, acceptance, both rollover, several pooled entries), 7 green (fixed/product/license/hourly, usage tiers, typed-config Bucket overlay, fixed advance, pricing schedule, discount, known gap). At HEAD: 15/15.
- Per-entry vs aggregated rounding genuinely diverges: 50+50 min, 15-min round-up: engine 2.00h (60+60), simulator 1.75h (105 min once). Left as a documented known gap (LEVERAGE pattern per-entry-vs-aggregated-hours); the assumption model carries hours per period, not per entry.
- Discounts: simulated through the same compute pipeline; parity compares the discount line (-10% of gross).
- Engine dumps of all 14 parity engine runs (pool fixtures included): base vs HEAD whole-result identical, charges and discounts, in order.
- Existing integration suites (42 files, listed in the PR notes), base vs HEAD: identical pass counts (contractSimulator 10 -> 11 = the added template-pool test). 156 engine results (530 charges) dumped; after normalizing ids, random name suffixes and ticket numbers, every result is identical as a multiset and whole-result. Exact ORDER of equal-family charges (and of invoices created in one test) is nondeterministic on base alone (two base-only runs of billingInvoiceTiming/billingProfileAttribution show the same variance: typeSeq 64/65 and 10/11 identical, exact order 63/65 and 7/11), so it is not a regression signal. Bucket-only suites (bucketUsage*, remainingBucketUnits, wizardBucketPoolSubmission, ...) never call the engine; they are run for pass/fail only.
- Build: ee/server `tsc --noEmit` clean; `npm run build` (next build --webpack) exits 0 after building `packages/jobs` dist (its subpath imports are unresolved in a fresh checkout until `tsup` runs there; unrelated to this change).
