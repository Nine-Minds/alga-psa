# Tax rate cap draft validation

Validated on 2026-09-17 against parent HEAD `0e338a5994`, using the dev stack at
`http://localhost:3509`. The existing local PRD and the Design Session packet
were read before implementation. The PRD's verified currency and composite
corrections govern this draft.

## Review first

- Selecting a rate currency restricts the entire rate's invoice applicability.
  New or changed caps require that explicit currency. No tenant-base-currency
  guess or migration backfill is performed. Existing universal capped rows
  remain visible, preservable, clearable, and explicitly resolvable.
- Composite component calculations still do not apply the row cap. The list,
  form, Details and Components views disclose this. Regional row contributions
  do apply it. Jurisdiction, period reset and rounding decisions remain in the
  parent contract's open questions.
- The public GET now returns actual tax rates instead of transactions. Its
  response includes normalized minor-unit amounts. This draft adds no public
  tax-rate mutation endpoints; the shared create/update schemas describe the
  data contract.

## Automated checks

| Check | Result | Evidence |
| --- | --- | --- |
| Billing package typecheck and build | Passed | `/tmp/tax-cap-final-typecheck.log`, `/tmp/tax-cap-final-build.log` |
| Full server TypeScript check | Passed with 12 GiB Node heap | `/tmp/tax-cap-final-server-typecheck.log` |
| Final form, screen, money and preloaded tax tests | 89 passed in 4 files | `/tmp/tax-cap-final-components.log` |
| DB actions, API, parent selection and real recurring drafts | 69 passed in 2 files | `/tmp/tax-cap-validation-db-final.log` |
| Combined parent/default/period/composite and billing regression run | 287 passed in 13 files before final UI test additions | `/tmp/tax-cap-combined-tests.log` |
| Public schemas and existing delete error tests | 22 passed | `/tmp/tax-cap-final-api-tests.log` |
| Community / EE shared action and schema tests | 16 passed per edition process | `/tmp/tax-cap-validation-db-ce.log`, `/tmp/tax-cap-validation-db-ee.log` |
| Locale keys, parameters and pseudo-locales | No errors or warnings | `/tmp/tax-cap-final-translations.log` |
| CE and EE OpenAPI generation | Passed; six snapshots updated for tax rates | `sdk/docs/openapi/` |

The four focused test files are under `server/src/test/unit/billing/`:
`taxCapForm.test.ts`, `TaxCapFields.test.tsx`, `TaxRates.test.tsx` and
`taxCapInvoiceCompute.test.ts`. They test real cap field/form logic; UI
infrastructure and action boundaries are mocked in component tests.

`packages/billing/tests/tax/taxRateCaps.db.test.ts` executes real tenant-scoped
queries in rollback transactions. It covers action/API guards, legacy pairs,
minor-unit validation, PostgreSQL constraints, currency selection, the real
preloaded billing context, and recurring draft generation. Its recurring cases
call actual `previewInvoice` and `generateInvoice`, then compare preview,
persisted invoice and charge tax for GBP 5.00, no cap and zero on GBP 100.00.
The client default remains USD. Tax calculation and invoice persistence are
not mocked; auth and analytics boundaries are fixture-controlled.

Useful commands from the repository root:

```sh
npm run typecheck --workspace=@alga-psa/billing
npm run build --workspace=@alga-psa/billing
NODE_OPTIONS=--max-old-space-size=12288 npx tsc --noEmit --project server/tsconfig.json
node scripts/validate-translations.cjs
git diff --check
```

Run focused component tests from `server/` with `npx vitest run` and the four
file paths above. DB tests are discovered by the workspace DB lane. Local DB
verification used `/tmp/tax-cap-db.vitest.config.ts` with the server aliases,
serial execution, an explicitly named migrated `test_database`, and app-user
credentials read privately from the existing secret file. No database reset
was performed. The original default-heap server typecheck exhausted memory;
the explicit 12 GiB run completed successfully.

## Live administrator journey

Evidence is in `/tmp/alga-smoke-evidence/tax-cap-ui-20260917/`. Headed Chrome
used a fictional administrator and client, the actual Tax Rates controls,
and Billing > Invoicing > Generate > Manual Invoice. All cap writes were UI
saves. SQL was used only for fixture prerequisites and read-only result
verification. Every row below was saved, reloaded, reopened, and used on a new
USD 100.00 draft at 10% tax.

| UI cap | Stored cap | Draft tax | Draft total | Invoice number |
| --- | --- | --- | --- | --- |
| 5.00 | 500 | USD 5.00 | USD 105.00 | `CAP-1789626560836-500` |
| 3.00 | 300 | USD 3.00 | USD 103.00 | `CAP-1789626571420-300` |
| Clear | NULL | USD 10.00 | USD 110.00 | `CAP-1789626581702-clear` |
| 0 | 0 | USD 0.00 | USD 100.00 | `CAP-1789626592219-zero` |

`results.json` records invoice IDs and stored values. `cap-*-reopened.png`
captures hydrated forms. `invoice-*-loaded.png` and matching UI text capture
the completed draft previews.

A further invoice, `CAP-1789627427799-two-regions`, used two USD 100.00 charges
in different regions, each with a USD 5.00 cap created through Tax Rates. It
persisted USD 10.00 tax and USD 210.00 total. See `two-regions-results.json`
and `invoice-two-regions.png`. Two charges in the same region instead share
one regional calculation and produced USD 5.00 tax, as the parent flow intends.

USD `5.001` was rejected with localized precision feedback and focus on the
invalid field. A dedicated billing-read-only user could inspect rows/details
but could not use Add, Edit, Delete or detail mutation controls. Mobile 360px
and desktop checks covered light/dark themes, the long `yy` pseudo-locale,
keyboard clear/disclosure controls and the sticky footer. Edit Escape, Cancel
and Save all returned focus to the row menu after the focus fix. See
`viewport-readonly-evidence.md`, the associated screenshots and
`focus-restoration-retest.log` in the evidence directory.

## Environment and verification limits

The dev/test databases initially lacked inherited additive migrations needed
by this checkout. Only existing named migrations were applied: the parent
cap column, numbering prefix format, invoice charge provenance, invoice time
snapshot, and (test DB only) billing semantics lock. No replacement cap or
currency migration was added. These prerequisites and evidence paths are
recorded as workflow facts.

CE/EE checks used separate edition environment processes against the same
shared migrated PostgreSQL schema, including actual nullable column metadata,
the validated negative-cap constraint and real rate mutations. They were not
two independently deployed edition stacks. A full Next production build was
not run; billing build, full server typecheck and the running application were
verified. Human jurisdiction review and broader deployment checks remain
separate from this first draft's evidence.
