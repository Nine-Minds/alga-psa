# Implement desk verification — 2026-10-14

Starting revision: `48bf4fe5f1b3d00d63dd6a208bbf6d3febe9c601`, PR #3499.

The existing draft preview mounts `DraftInvoiceAdjustmentsCard`, which passes the
selected invoice to the shared manual editor. Manual updates use the existing
charge/discount persistence and locked lifecycle checks. Generation invokes the
companion contract-change reconciler and shared automatic discount/tax pipeline.
This pass adds no persistence or scheduling implementation.

Fixed returned capability permission errors being ignored by the card, allowing
the editor to mount despite denied access. The card now displays the returned
message and clears the old invoice capability on selection changes. Four
behavioral component tests cover allowed access, denied access, stale blocked
state, and late responses. Before the fix, the two denial cases failed; afterward
all four pass. Server write guards remain intact.

The prior CI run `38500284099` also exposed two incomplete database test doubles
(missing `schema.hasTable`) and a PDF browser-release mock whose promise
implementation was lost between parameterized cases in the server runner.
Updated those test fixtures; production schema checks and output assertions remain.

## Commands and results

Run from `packages/billing`:

```sh
npx vitest run --maxWorkers=6
```

375 files, 2,039 tests passed; exit 0. The first post-fix run passed every
assertion but exited 1 on an asynchronous Radix/jsdom `dispatchEvent` teardown
error attributed to `accountingExportsTab.connectionsFailure.test.tsx`. The
complete rerun above passed without that error. The pre-fix baseline had 37
failures across the two incomplete database fixtures.

Run from `server`:

```sh
npx vitest run ../packages/billing/tests/DraftInvoiceAdjustmentsCard.test.tsx ../packages/billing/tests/accounting/accountingExportValidation.rules.test.ts ../packages/billing/tests/generatedDocumentFiling.test.ts ../packages/billing/tests/pdfContractChangeDescriptions.test.ts --maxWorkers=2
```

4 files, 50 tests passed; exit 0. Includes positive and negative true-up PDF output.

Run from the repository root:

```sh
NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p packages/billing/tsconfig.json
npx eslint packages/billing/src/components/billing-dashboard/invoicing/DraftInvoiceAdjustmentsCard.tsx packages/billing/tests/DraftInvoiceAdjustmentsCard.test.tsx packages/billing/tests/accounting/accountingExportValidation.rules.test.ts packages/billing/tests/generatedDocumentFiling.test.ts packages/billing/tests/pdfContractChangeDescriptions.test.ts
git diff --check
```

Typecheck: exit 0, zero diagnostics. Default-heap attempt exhausted Node memory;
the 8 GB invocation above completed. Lint: exit 0, zero errors and 70 warnings
(existing test typing/style warnings). Diff check: exit 0.

## Scope of evidence

No deployment, merge, live UI smoke rerun, database mutation, or board transition
was performed. Earlier live preview/PDF/portal/export evidence remains tied to
its recorded revision. These automated checks do not establish fresh Open Review
access or signed-in reviewer readiness. Repository-wide CI must report on the
pushed revision; this report claims only the local checks listed above.
