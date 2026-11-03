# Prepaid hours mitigation review

Start with the work-date eligibility query in `shared/billingClients/hourBlockService.ts` and the behavioral cases in `packages/jobs/tests/prepaidBlockContractEnd.db.test.ts`.

The merge retains late-time labels, the shared charge resolver, the bucket-hours status filter, the Remaining value and Valid from columns, and the T003 service-period inventory fix.

Late-approved time draws the block that was valid on the work date, even after that block expires. Only uncovered time bills as arrears overage. Voiding or unfinalizing an unused expired purchase removes its paid coverage; a used block prevents reversal. Invoiced allocations remain fixed.

An assignment marked **renewing** keeps its purchased blocks usable until each block's own expiry, with or without a linked renewal draft. The assignment's original end date no longer strips this coverage during allocation or reconciliation. A recorded termination still caps the renewal interval: earlier work remains covered, and work after termination does not draw the block. The expiry and invoice-reversal checks continue to apply.

Verification against `alga2684_prepaid` at `127.0.0.1:5472`:

- [183 database tests across 20 files](evidence/tests/takeover-renewal/database.log), including all nine prepaid acceptance tests, with no skips.
- [34 engine–simulator parity tests](evidence/tests/takeover-renewal/parity.log), including the saved-contract $3,000 initial invoice and $3,600 subsequent invoice with four overage hours.
- [67 simulator tests](evidence/tests/takeover-renewal/simulator.log).
- [66 service-period inventory tests](evidence/tests/takeover-renewal/inventory.log), including T003.
- Shared, billing, jobs and EE server typechecks; command logs are in the same evidence directory.

Current-revision live acceptance remains outstanding; the existing screenshots and walkthrough show an older revision. No application server was started or restarted.

The [migration-lint scan](evidence/tests/takeover-renewal/migration-lint.log) still reports the previously identified migration findings. This repair changes no migrations.

Blocks follow the line cadence, as accepted in O7. Cycle-change money preview remains on card `f0083794`.

## Post-main merge

The merge of main at `c37e24a86a` retains late-service-period marking, shared resolver coverage, the bucket-hours status filter and report columns, and the T003 inventory reference. The tenant deletion manifest and foreign-key snapshot now match the prepaid migration: hour blocks are deleted before issuances, and their issuance foreign key is `NO ACTION`.

At code revision `22429d8ca1`, the [database run](evidence/tests/post-main-merge/database.log) passed 183 tests across 20 files, including all nine acceptance tests, without skips. [Parity](evidence/tests/post-main-merge/parity.log) passed 34, [simulator](evidence/tests/post-main-merge/simulator.log) passed 67, [inventory](evidence/tests/post-main-merge/inventory.log) passed 66, and the [manifest suite](evidence/tests/post-main-merge/alga2684-final-manifest.log) passed 10. Shared, billing, jobs, EE server, and DB typechecks passed. The $3,000 and $3,600 saved-contract results are automated checks; the screenshots and walkthrough are historical live evidence.

The [current migration scan](evidence/tests/post-main-merge/alga2684-final-migration-lint.log) reports nine violations and four undecided findings across three already-applied prepaid migrations. The prior PR CI run failed tenant management schema validation because its deletion order differed from the manifest; see the [post-repair validation job](https://github.com/Nine-Minds/alga-psa/actions/runs/40620908884/job/122594684997) for its result. The isolated database lacks unrelated EE schema needed for the full foreign-key snapshot check.

The production review build is recorded in `server/.next-review-takeover`: check `BUILD_ID`, `.alga-review-revision`, and `.alga-review-build-result.json` against the current Git HEAD before using the artifact. The build log is `/tmp/alga2684-final-build.log`. The build does not start a server.
