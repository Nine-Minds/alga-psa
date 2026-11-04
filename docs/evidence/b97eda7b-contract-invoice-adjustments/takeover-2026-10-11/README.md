# Contract invoice mitigation takeover, 2026-10-11

The retained production invoices now have PDF, source-identity and ledger evidence. Two additional defects were found and repaired in this checkout: fixed-service template lines lost their source identity at wizard submission, and pre-generation previews used legacy discounts instead of the configured settlement policies. These source changes are not deployed to the running review app. Review the preview repair first.

The production build remains `0826a475429d25fe5a3647ef6a5e7df7c241e7cf+da39a3ee5e6b`. The starting PR checkpoint is `e612e1fd63be514e449d81d72dbe26e5112a4fc1`, not a claim about the final commit. No app server was started or restarted. This report supersedes the billing-validation gaps in the [round 3 report](../mitigation-2026-10-11/README.md); it does not replace its template-copy independence evidence.

## Production evidence in AUD

| Retained draft | Generated charges | Automatic discounts | Manual addition | Subtotal and posted principal |
| --- | ---: | ---: | ---: | ---: |
| INV-000041, Client A | A$320.00 | 12% = −A$38.40; fixed −A$25.00 | A$15.00 | A$271.60 |
| INV-000042, Client B | A$200.00 + A$120.00 | 12% = −A$38.40; fixed −A$25.00; Cabling line 10% = −A$12.00 | None | A$244.60 |

Both drafts have `tax_source=pending_external`. The PDFs show zero provisional tax; these are not assertions of completed external-tax calculation.

Client A's [before](invoice-before.json) and [after repeat save](invoice-after-repeat.json) snapshots prove five unchanged charge IDs, two distinct source-linked discount settlements, and the preserved manual row. Both discounts retain a 32000-minor-unit contract base. The ledger contains `invoice_generated=25660` and one `invoice_adjustment=1500`; repeat save adds no posting. The actual UI-downloaded [INV-000041 PDF](INV-000041.pdf) agrees at A$271.60.

Client B was generated through **Automatic Invoices → Preview Selected → Generate Invoice** in the existing production app. Its ready September group was on a later result page; filtering by the review-owned client revealed it. The earlier conclusion that only the future October period was available was incomplete. The fresh copy has two distinct Fixed lines: Managed Workstation and Cabling product. The Cabling-only discount has base 12000 and amount −1200; the 20000 sibling is excluded. [Database evidence](line-scope-database.json), [saved invoice screenshot](line-scope-invoice.png), and the actual UI-downloaded [INV-000042 PDF](INV-000042.pdf) agree at A$244.60.

[Repeat-save evidence](line-scope-after-repeat.json) proves unchanged charge and settlement IDs, unchanged single `invoice_generated=24460` posting, and two billed service-period claims linked to the invoice. [Refreshed Automatic Invoices](candidates-after-generation.json) shows zero ready/combinable candidates for Client B and September in history. The UI has no supported regeneration action for a billed period. We did not clear claims, reverse a draft, or force a duplicate generation to fabricate a retry. Behavioral duplicate-prevention tests pass for both client and contract cadence; the database regression evaluates and reconciles the same policies twice, retaining settlement IDs. A network replay of the production Generate request was not performed.

PDF launch initially failed because the user's `/tmp` quota was exhausted. A stale 71 MB Nx temporary directory belonging to absent PID 3955428 was archived intact under `/home/robert/.alga-dev/review-fixtures/b97eda7b/takeover-archive/`, with a symlink preserving its old path. The production Download PDF buttons then succeeded without restarting the app. Both files above are downloaded application bytes, not substitute renders.

## Repairs and verification

`projectFixedLinesForSubmission` now retains `source_template_line_id`, so fixed-service copies preserve the template line referenced by a scoped default discount. The UI submission regression fails when that one-line repair is removed. The database wizard test now passes through this submission projection before creating two same-method copies with the same service on distinct lines.

The production [pre-generation preview](preview-before-repair.json) incorrectly showed only a −A$32 line discount and total A$288.00 for Client B. The generated invoice correctly applied three discounts and totaled A$244.60. `previewAutomaticInvoiceDiscounts` now loads the same source policies and invoice service window as settlement and uses the shared evaluator. It matches fixed-charge consolidation before evaluation. The action renders these results and uses only the selected billing profile's charges for tax and totals. It neither writes settlement rows nor claims service periods.

Verification logs are in [validation.txt](validation.txt). The focused database cases compare preview and settlement amounts, source identities, line bases, independent fixed defaults, service-window eligibility, fixed allocation consolidation and repeat reconciliation. The broader adjustment database run passed 62 of 64 tests. Two QBO allocation-tax assertions fail with 462 instead of 418 on both this tree and the untouched starting checkpoint; Xero round trips pass. This existing external-tax issue was not changed or hidden by weakening its assertions.

The repaired preview and fixed-service wizard path still need a production deployment and UI rerun. The successful production line-target fixture uses Cabling's product path, which retained its source identity before this repair. No fresh portal or combined-companion acceptance is claimed.

## Open Review release handoff

Alga Dev repair: **`69cb91dd5b58a5aa5560e2c7a0b11aa5ae6cd562`**. Preceding repair: **`df8e9c219b38049f60fca8bd332e698181ddc46b`**. The separate checkout `/home/robert/alga-dev-open-review` matches its upstream. All 25 focused tests passed again; the builder's TypeScript pass is retained.

The supported route is `npm run deploy:publish` from the Mac checkout's `ghostty-pane-ide` directory, documented in `docs/plans/2026-08-24-distributed-alga-dev/RUNBOOK.md`. At takeover, `alga-dev list-terminals --allTabs` returned no terminal panes, and `nc -vz -w 3 100.70.145.1 22` returned `Connection refused`. No supported remote execution path was available here; fleet activation was not performed.

The release operator should include both full commits in the current fleet release, run the supported publisher, and confirm the installed version contains the repair. Then test a review pane that is absent, an existing pane, and repeated calls without duplicate panes. Use `alga-dev workflow-open-review --projectId=b97eda7b-0e3f-4b09-be80-6b57f934d8a5 --activate=false` and verify the actual authenticated billing page. The named pane is `review-app-b97eda7b-0e3f-4b09-be80-6b57f934d8a5-ts_robert-X670E-Pro-RS`. Account identity need not be QA. Do not mark the missing-pane repair live until these checks pass.

## Retained fixtures and cleanup

Tenant: `6d178771-ad9a-4d43-8809-83992745f8f9`. Review app: <http://feature-contract-invoices-automatic-adjustments-and-disc.localhost:23185>.

- [Client A invoice](http://feature-contract-invoices-automatic-adjustments-and-disc.localhost:23185/msp/billing?tab=invoicing&subtab=drafts&invoiceId=7c0f201e-ada6-458f-8463-6b3d4ffbdc78), client `1992b9da-939c-4be1-a110-ed6356a5dd69`.
- [Client B invoice](http://feature-contract-invoices-automatic-adjustments-and-disc.localhost:23185/msp/billing?tab=invoicing&subtab=drafts&invoiceId=cc1b7023-0c3a-4f7d-b271-d78eadb9c8c2), client `ab0d087c-c435-42c8-90a3-256fd304f268`.
- [Line-scope client copy](http://feature-contract-invoices-automatic-adjustments-and-disc.localhost:23185/msp/billing?tab=client-contracts&contractId=a8fcc363-f389-44fb-81e5-98fc0d3633ab&clientContractId=42855623-69f8-4351-b36b-cb3fb21b989f).
- [Template](http://feature-contract-invoices-automatic-adjustments-and-disc.localhost:23185/msp/billing?tab=contract-templates&contractId=566a5bd6-2435-4818-b147-60edf805adbd).

Retain both generated drafts and their source copies for review. After review, use each owned invoice's **Reverse Draft** action if cleanup is desired. Preserve the resulting audit/locked history; do not delete charge, ledger or billed claim rows directly. Remove only review-owned templates/contracts/clients through supported UI when their history permits it. Synthetic billing addresses end in `.invalid`; no email was sent. Do not rewrite source terms on already billed periods merely to rerun the walkthrough.

Delivered QBO history is excluded from cleanup: invoice `5a1e0000-0000-4000-8000-202610079004`, batch `3ac31e06-9479-4f5d-9c73-170a880d80d9`, simulator `invoice-21`, total/principal 385000. Do not unlock, reset, delete or re-export it. Existing shared review invoices were not edited during takeover.
