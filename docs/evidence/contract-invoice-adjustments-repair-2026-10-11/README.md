# PR #3499 current-head handoff — 2026-10-11

**Status: BLOCKED for human review.** The implementation can be reviewed, but
the prior READY claim is withdrawn until repaired-HEAD browser acceptance is
captured. The app server was deliberately left stopped. The old review service
and its prior `add21274560c861a2d277582a518ae940a131795` evidence do not prove
the merge result. The base conflict is resolved in this branch; portal output,
real app-to-Xero-simulator delivery, and automatic companion true-up acceptance
remain open.

## Review first

1. Review the merge-resolution changes in `packages/billing/src/actions/contractWizardActions.ts`.
   Both the currency-aware per-template-line wizard API and the source-line
   identity used by copied line discounts must survive. The two focused DB
   tests that exercise this path are named “keeps fixed and Fixed template
   sources separate through creation and settlement” and “keeps fixed and
   Hourly template sources separate through creation and settlement”.
2. Review the companion implementation in `seatRevisions.ts` and
   `reconcileContractChangeAdjustments.ts`. It owns recurring revision history
   and the single mid-period true-up writer. The invoice evaluator consumes
   its already-prorated settlement; it must not prorate it again.
3. Use the unbilled candidate below for the first current-HEAD browser
   walkthrough. Do not use the delivered QBO fixtures listed under
   `docs/evidence/b97eda7b-contract-invoice-adjustments/mitigation-2026-10-11/`.

## Fixture state and safe setup

The review-owned Client B contract copy prepared in the prior pass is **no
longer unbilled**: the takeover generated `INV-000042`
(`cc1b7023-0c3a-4f7d-b271-d78eadb9c8c2`) for its September service window.
The older `candidates-after-generation.json` confirms no automatic candidate
remained after that generation. It is retained as billed history and must not
be regenerated, reversed, or cleaned up for this review. Consequently this
checkout does not currently have an unbilled browser-generation candidate.

The app server was required to remain stopped, and no database fixture writes
were made. To prepare a fresh isolated candidate when a current-HEAD review
service is available, use the supported UI and a new synthetic client (never
reuse Client B or a billed period):

1. In **Clients**, create `REVIEW-3499-HEAD-UNBILLED-20261011` with a unique
   `.invalid` billing address. Record its generated `client_id`.
2. From **Billing → Contract Templates**, use the populated template below.
   Create a new client contract from its wizard. Record the generated contract
   and client-contract assignment IDs; verify the two lines copied separately.
3. On that contract's **Discounts** tab, verify independent active copies of
   the 12% contract discount, A$25 fixed contract discount, and 10% Cabling
   line discount. Record each new `discount_id` and the target
   `contract_line_id` before generation.
4. Keep it unbilled until Automatic Invoices shows an eligible candidate for
   its first full October 2026 arrears window. Then use Preview Selected →
   Generate and retain the request, response, invoice, charge and settlement
   identifiers. If the candidate is not yet eligible, leave it unbilled and
   wait for the service window; do not force generation by editing dates.

This handoff records the retained fixture's known IDs and expected amounts to
make that setup repeatable, but it does not claim a fresh unbilled fixture has
already been created. The missing live candidate is part of the blocked
readiness state.

| Record | Identifier / value |
| --- | --- |
| Tenant | `6d178771-ad9a-4d43-8809-83992745f8f9` |
| Template | `REVIEW-3499-MITIGATION-TWO-FIXED-LINES` / `566a5bd6-2435-4818-b147-60edf805adbd` |
| Template lines | Managed Workstation `89e47435-bb9c-4d48-801c-91d80c1d4c4c`; Cabling `edab1b08-848b-4946-8b1d-265dae4ee428` |
| Client B | `REVIEW-3499-MITIGATION-CLIENT-B` / `ab0d087c-c435-42c8-90a3-256fd304f268` |
| Client contract | `REVIEW-3499-LINE-SCOPE-COPY-B` / `a8fcc363-f389-44fb-81e5-98fc0d3633ab` |
| Client-contract assignment | `42855623-69f8-4351-b36b-cb3fb21b989f` |
| Independent copied terms | contract 12% `REVIEW-3499-MITIGATION-DEFAULT-12P`; contract fixed A$25 `REVIEW-3499-MITIGATION-DEFAULT-FIXED-25`; Cabling line 10% `REVIEW-3499-LINE-CABLING-10P` |
| Current eligible source amounts | Managed Workstation A$200 (20000 minor units); Cabling A$120 (12000 minor units) |
| Expected line-only settlement | Cabling base 12000; 10% discount −1200; the sibling 20000 is excluded |
| Expected full invoice before tax | A$244.60 / 24460 minor units, from 32000 gross, −3840 contract percentage, −2500 contract fixed, and −1200 Cabling-only percentage |
| Next service window | October 2026 in arrears, due for generation on 2026-11-01; confirm the current candidate row and dates in Automatic Invoices before generating |

Historical generated invoice for the retained copy: `INV-000042` /
`cc1b7023-0c3a-4f7d-b271-d78eadb9c8c2`, before-tax subtotal 24460, tax 0
(`pending_external`). Keep it intact as review history.

Navigation: **Billing → Invoicing → Automatic Invoices**. Select Client B's
`REVIEW-3499-LINE-SCOPE-COPY-B` candidate, preview, then generate only when the
window is eligible. Compare generated line amounts and all three discount
settlements with the table above. Open the resulting invoice under **Drafts**,
reload, and repeat the same generation request through the supported UI; there
must be one settlement per copied source and stable settlement IDs. Record the
request, invoice ID, all source/settlement IDs, persisted subtotal/tax/total,
and screenshots. Pending external tax must be reported separately from a
settled tax amount.

The previously observed Automatic Invoices preview included a `−A$32` line
discount because the old preview treated that copied term as invoice-wide.
That screenshot is a defect reproduction only. The current-head expected
line-scope value is `−A$12` on Cabling alone.

### Read-only baseline queries

Run these against the review DB before generation and retain the output. They
must return the exact template, assignment, copied terms and line composition;
there must be no invoice/charge for this client's next service period.

```sql
-- Template source lines and source amounts.
SELECT ctl.template_line_id, ctl.template_line_name, ctl.line_type,
       ctl.billing_frequency, ctl.display_order,
       s.service_name, tls.quantity, tls.custom_rate
FROM contract_template_lines ctl
LEFT JOIN contract_template_line_services tls
  ON tls.tenant = ctl.tenant AND tls.template_line_id = ctl.template_line_id
LEFT JOIN service_catalog s
  ON s.tenant = tls.tenant AND s.service_id = tls.service_id
WHERE ctl.tenant = '6d178771-ad9a-4d43-8809-83992745f8f9'
  AND ctl.template_id = '566a5bd6-2435-4818-b147-60edf805adbd'
ORDER BY ctl.display_order, s.service_name;

-- Assignment-owned discount copies and their persisted scopes/targets.
SELECT a.assignment_id, a.client_contract_id, d.discount_id, d.discount_name,
       d.discount_type, d.value, d.scope, d.scope_service_id,
       cld.contract_line_id, d.start_date, d.end_date, d.is_active
FROM contract_discount_assignments a
JOIN discounts d
  ON d.tenant = a.tenant AND d.discount_id = a.discount_id
LEFT JOIN contract_line_discounts cld
  ON cld.tenant = a.tenant AND cld.client_contract_id = a.client_contract_id
 AND cld.discount_id = a.discount_id
WHERE a.tenant = '6d178771-ad9a-4d43-8809-83992745f8f9'
  AND a.client_contract_id = '42855623-69f8-4351-b36b-cb3fb21b989f'
ORDER BY d.priority, d.discount_name;

-- No invoice or charge has already claimed the next service period.
SELECT i.invoice_id, i.invoice_number, i.status, d.item_id,
       d.service_period_start, d.service_period_end,
       c.adjustment_source_kind, c.adjustment_source_id
FROM invoices i
LEFT JOIN invoice_charges c
  ON c.tenant = i.tenant AND c.invoice_id = i.invoice_id
LEFT JOIN invoice_charge_details d
  ON d.tenant = c.tenant AND d.item_id = c.item_id
WHERE i.tenant = '6d178771-ad9a-4d43-8809-83992745f8f9'
  AND i.client_contract_id = '42855623-69f8-4351-b36b-cb3fb21b989f'
  AND i.invoice_date >= DATE '2026-10-01'
  AND i.invoice_date < DATE '2026-12-01'
ORDER BY i.invoice_date, i.invoice_number;
```

### Cleanup boundary

This review-owned template, Client B, client contract, copied discounts and
any generated invoice are retained for review. Do not delete or reset them
until the reviewer confirms completion. If cleanup is later requested, reverse
only an editable draft through the supported UI, verify its recurring history,
then remove only these explicitly owned records. Never unlock, reset, delete,
or re-export delivered QBO review history; in particular preserve invoice
`5a1e0000-0000-4000-8000-202610079004`, batch
`3ac31e06-9479-4f5d-9c73-170a880d80d9`, and simulator invoice `invoice-21`.
Keep shared credentials and shared fixtures unchanged.

## Remaining current-HEAD acceptance

- **Client portal:** sign in as a Client B portal contact and compare its
  invoice line/discount/tax output with the persisted invoice and MSP preview.
- **Xero simulator:** from the real application UI, execute a fresh isolated
  Xero export. Capture the application request, simulator response, persisted
  settlement and export lock. Do not reuse or mutate delivered QBO history.
- **Companion true-up:** through the real recurring-unit schedule workflow,
  create separate quantity increase and decrease revisions with mid-period
  opt-in. Verify canonical revision identity/version, half-open dates,
  signed already-prorated amount, reason, earliest eligible editable invoice,
  discount ordering, one settlement per revision, and repeat-generation
  stability. Do not fabricate ledger source rows as acceptance.
- **Browser freshness:** run all above against an application built from the
  merged commit. The app stayed stopped for this implementation; the older
  review build is not current-head evidence.
