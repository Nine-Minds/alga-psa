# Accounting export repair

PR #3499 now gives discounts an explicit accounting mapping and requires a tenant-owned catalog service on manual charges. The repair includes the mapping editor, miscellaneous-service provisioning, save-time warnings, and all five accounting adapters.

## Review first

For review, start with the active integration's discount mapping, then compare the signed amounts in the CSV/IIF artifacts with the mocked Xero request and QBO payload. Next verify the fixed-plan parent: its two persisted $1,950 service allocations total $3,900 once, and the export keeps the parent batch line identity while serializing the allocation rows.

- In each accounting mapping screen, open **Discounts and credits**. QBO uses an account ID; Xero uses an account code; QuickBooks CSV uses a discount item name. QuickBooks CSV settings also expose **Desktop discounts**, **Desktop service accounts**, and Desktop tax accounts for IIF exports. API targets are checked against the connected accounting company before saving. Mapping actions enforce tenant ownership, accounting permissions, and realm scope.
- **Miscellaneous / One-time charge** is an ordinary editable catalog service with a stable tenant-derived ID. The migration provisions existing tenants; tenant initialization and provisioning cover new tenants. It is selected for new manual charges and needs an ordinary service mapping. Existing invoice rows are never silently assigned to it.
- The shared writer rejects serviceless positive charges. Updates validate the effective persisted row, so description-only edits keep a valid existing service. Unknown/foreign services and edits to legacy serviceless positive rows are rejected before writing. Negative-rate credits are classified before this requirement; a serviceless credit uses the discount mapping.
- Save-time warnings identify unmapped manual lines, generated services and automatic discounts. Batch validation and QBO finalize readiness remain authoritative. Saving a draft is allowed while its accounting mappings are incomplete.
- Consolidated fixed-plan parents are exported through their persisted service allocations exactly once. Net and tax allocation sums must match the parent. Batch line identity remains the parent; remote split identity uses each detail ID.

Discount export amounts come from the settled invoice amount. QBO uses fixed native discount lines. Xero uses negative lines on the mapped discount account; exact credit quantities are retained when their rates can reproduce the settlement. CSV uses a quantity of one for discount rows so two-decimal rate formatting cannot change a fractional settlement. IIF uses signed mapped-account splits and a balanced receivable transaction. Numeric CSV amounts remain numbers; descriptions and other text still receive spreadsheet-formula protection.

## Reproducible export evidence

The artifacts below were produced by the real adapters against isolated database fixtures named `REVIEW-CONTRACT-3499-<adapter>`. They are not downloads from the retained review-app invoice. The fixtures contain $3,900 in generated fixed-plan allocations, a $150 miscellaneous charge, a $1.01 fixed discount with quantity 3, a manual 10% discount, an automatic 10% settlement, and a 3 × $0.33 credit. Every export represents $3,238.00 before tax. Tests also remove the discount mapping and assert that each adapter rejects the export.

| Adapter | Evidence | What was checked |
| --- | --- | --- |
| QBO | [Invoice JSON](artifacts/quickbooks_online.json) | Four native discount lines on the configured account; generated allocations and misc charge appear once; signed sum matches the database. |
| Xero | [Mocked HTTP request](artifacts/xero.json) | Real client serialization with only its transport mocked; every quantity × unit amount matches the line amount, including percentage and fractional fixed settlements. |
| QuickBooks CSV | [CSV](artifacts/quickbooks_csv.csv), [adapter result](artifacts/quickbooks_csv.json) | Real adapter delivery artifact; parsed signed quantities × rates equal the persisted net total. |
| Xero CSV | [CSV](artifacts/xero_csv.csv), [adapter result](artifacts/xero_csv.json) | Independent `xero_csv` mappings; negative numeric cells and settlement totals survive parsing. |
| QuickBooks Desktop | [IIF](artifacts/quickbooks_desktop.iif), [adapter result](artifacts/quickbooks_desktop.json) | Mapped service/discount account splits; receivable plus splits sums to zero. |

## Fixed-plan external-tax round trip

The QBO and Xero round-trip fixtures include two $1,950 allocations under one $3,900 consolidated parent, a $150 manual charge, a $390 automatic discount, $1.10 of original tax, and a mocked provider response with $4.35 of changed tax. Both imports update the parent and manual line, recalculate the invoice total to $3,664.35, and leave the discount amount intact. QBO's invoice-level tax is split across its sales lines ($4.18 onto the parent and $0.17 onto the manual charge); Xero's per-line taxes aggregate $4.10 from the two allocation IDs onto the parent and $0.25 onto the manual charge.

- [QBO provider response, persisted split identities, import, repeat import and update mapping](artifacts/tax_roundtrip_quickbooks_online.json)
- [Xero provider response, persisted split identities, import, repeat import and update mapping](artifacts/tax_roundtrip_xero.json)

The adapters retain each allocation's detail ID as its retry/update identity and also record the parent charge ID. Tax import aggregates returned allocation taxes onto that parent while direct lines such as the manual charge keep their own tax. A repeated import is rejected after `tax_source` becomes `external`; assertions confirm it does not change tax, totals, or create a second import record. Provider responses in these fixtures are mocked; they do not claim live QBO/Xero acceptance.

Regenerate artifacts from `server/` with:

```sh
ACCOUNTING_EVIDENCE_DIR="$PWD/../docs/evidence/accounting-export-adjustments-repair-2026-09-29/artifacts" npx vitest run --config vitest.workspace-db.config.ts ../packages/billing/src/services/contractInvoiceAdjustments.db.test.ts
```

This recreates the isolated test database. Run database suites serially.

The September 30 rerun used the current adapter writers and isolated DB fixtures. The API examples use USD with no tax, so the artifacts demonstrate settled net totals but do not exercise nonzero tax or foreign currency. Code review confirms QBO serializes `CurrencyRef` and invoice `TxnTaxDetail`, while Xero serializes `CurrencyCode`, `LineAmountTypes` and per-line `TaxAmount`; the Xero artifact is a real serialized request with transport mocked, not a provider acceptance result.

## Validation

- Contract adjustment DB suite: 57 tests, including creation/update service validation, idempotent catalog provisioning, credits, settlement retries, lifecycle protections, all five adapter payloads, and the QBO/Xero external-tax round trips.
- External mapping DB suite: 35 tests, including create/read/update/delete of the discount identity for all five providers, realm/tenant isolation and invalid Xero accounts.
- Current-head focused unit rerun: 53 tests passed across accounting CSV serialization, export validation, save-time warnings and mapping-screen registration. The validation cases include fixed-parent child service mapping and allocation-total mismatch rejection.
- Credit/tax and invoice-generation discount DB suites: 11 tests. Positive manual fixtures now use a real service; tax and monetary expectations are unchanged.
- Billing unit suite: 1,627 tests across 323 files, including four editor-warning tests and 18 batch-validation tests. Integration unit suite: 960 tests across 115 files.
- Billing, integrations, database and server TypeScript checks pass (previous recorded verification). Billing package build passes. The integrations package's standalone build script has no configured entry points. The production application build completed with exit code 0 using a 16 GB heap and `.next-accounting-repair`; Webpack reported existing conflicting star-export and critical-dependency warnings, and Next skipped type validation. Separate package typechecks are the type evidence.
- Localization audit and pseudo-locales: 32 tests pass. Focused lint: zero errors; existing and test-fixture warnings remain.

## Current-head UI smoke pending

The app server stayed stopped. No current-head mapping-editor screenshots, actual Desktop import, live QBO/Xero delivery, portal walkthrough, or combined-companion validation is claimed. The mocked Xero request proves serialization, not provider acceptance. Historical invoice preview/PDF screenshots do not prove this accounting repair.

On the next authorized smoke step, use an owned copy of REVIEW-CONTRACT-3499:

1. Configure the active provider's service and discount mappings through settings; reload and verify them. Remove the discount mapping and verify the editor warning and export/finalize blocker, then restore it.
2. Add the default miscellaneous charge for $150, apply a manual or configured 10% discount, and save. For $3,900 + $150, verify the first-save discount is $405 and the net amount is $3,645. Repeat/reload must preserve row counts and ledger principal.
3. Edit and remove a manual charge; verify generated charges remain protected. Edit a legacy serviceless charge and verify service selection is required. Save a serviceless negative-rate credit and verify the discount mapping is used.
4. Download a CSV and compare its parsed amounts with preview, PDF and the posted invoice principal. Exercise the mocked/emulated provider export through the application when its server is available.
5. Test a consolidated fixed-plan invoice with tax and multiple allocated services; confirm no duplicated parent revenue. Restore owned fixtures and leave shared invoices unchanged.
