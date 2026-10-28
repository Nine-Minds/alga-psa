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

The production review artifact uses `server/.next-review-takeover`; its `BUILD_ID` and `.alga-review-revision` identify the compiled revision. No application server was started or restarted. Current-revision live acceptance remains outstanding; the existing screenshots and walkthrough show an older revision.

The [migration-lint scan](evidence/tests/takeover-renewal/migration-lint.log) still reports the previously identified migration findings. This repair changes no migrations.

Blocks follow the line cadence, as accepted in O7. Cycle-change money preview remains on card `f0083794`.
