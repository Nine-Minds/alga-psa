# T005 validation notes — portal vs MSP preview vs fresh PDF

- Ticket: alga-2026-0002528.
- Plan commit: `bec5fb3e` (`docs/plans/2026-09-21-client-portal-invoice-template/`).
- Implemented change: commit `44115764fc` (`fix(client-portal): honor resolved invoice template in portal preview`).
- Validated: 2026-09-21, worktree dev server `http://localhost:3919` (compose project `alga-psa-local-test`, Postgres on `127.0.0.1:5472`, database `server`).

## What T005 asks for

Using distinct visible designs for the tenant default and the client override, open the eligible invoice through client portal billing, compare to the MSP preview **without an explicit template override**, and compare to a **fresh PDF generated under unchanged settings**. Do not use an old published PDF to assert current-settings equality.

Distinct designs were achieved by rendering a **literal AST text node** at the top of each fixture template. This matters: a section `title`'s `defaultValue` is resolved through its `i18nKey`, so editing only `defaultValue` still renders the translated label and cannot distinguish templates.

## Fixtures

Invoice: `INV-000053`, `invoice_id=9f9b8c82-7019-473e-9527-e9c13d654150`, client Emerald City `986f8ae4-03b2-4997-b7fa-bbb8f404b867`, tenant `dd8cb218-d46d-47f3-be27-8aa50aad5fce`. Status was non-draft (`sent`/finalized) and no client-visible issued PDF existed.

Two custom templates were created for the tenant by cloning `standard-default` and prepending a literal text node:

| Fixture | template_id | Literal marker rendered |
| --- | --- | --- |
| SMOKE 2528 Client Override | `69cd0379-0956-4628-8608-45a346ecff2b` | `SMOKE-2528-CLIENT-OVERRIDE` |
| SMOKE 2528 Tenant Default | `5990d7b2-b198-43bd-90f0-ecd846f7726e` | `SMOKE-2528-TENANT-DEFAULT` |

- Case A (client override): `UPDATE clients SET invoice_template_id='69cd0379-…'` for Emerald City.
- Case B (tenant default): client override cleared, then `INSERT INTO invoice_template_assignments (tenant, scope_type='tenant', scope_id=NULL, template_source='custom', invoice_template_id='5990d7b2-…')`. This is the assignments table, not the legacy `invoice_templates.is_default` / `clients.invoice_template_id` default columns.

Surface URLs:

- Client portal: `http://localhost:3919/client-portal/billing?tab=invoices&invoiceId=9f9b8c82-7019-473e-9527-e9c13d654150`
- MSP preview (no `templateId` in the URL): `http://localhost:3919/msp/billing?tab=invoicing&subtab=finalized&invoiceId=9f9b8c82-7019-473e-9527-e9c13d654150`

## Evidence

### Case A — client override

| Surface | Observed |
| --- | --- |
| Client portal preview | DOM contained `SMOKE-2528-CLIENT-OVERRIDE` |
| MSP preview, no explicit override | DOM contained `SMOKE-2528-CLIENT-OVERRIDE` and the layout name `SMOKE 2528 Client Override` |
| Fresh PDF (MSP *Download PDF*, no template arg) | `pdftotext` contained `SMOKE-2528-CLIENT-OVERRIDE`; `sha256 72577be1d9c89dbc0c6722de21564ac91e54d3c846e2931ba1f90d27aaf0e489` |

Freshness proof — the invoice's generated document (`document_id=94bf39b4-cf81-4fa1-b3ee-31af5fbaabb1`) was re-rendered, not served from the stored copy:

- before: `source_template_id=98da0e3a-ef9a-473f-8095-17c1632ed473`, `file_id=20f0d7e8-921a-4e2f-ba99-c8f2984473d4`
- after: `source_template_id=69cd0379-0956-4628-8608-45a346ecff2b`, `file_id=eda29ea6-6d12-4d67-85d3-cf9af76ba8ff`, `updated_at=2026-09-21 04:59:19.384+00`

### Case B — tenant default

| Surface | Observed |
| --- | --- |
| Client portal preview | DOM contained `SMOKE-2528-TENANT-DEFAULT` |
| MSP preview, no explicit override | DOM contained `SMOKE-2528-TENANT-DEFAULT` and the layout name `SMOKE 2528 Tenant Default` |
| Fresh PDF (MSP *Download PDF*, no template arg) | `pdftotext` contained `SMOKE-2528-TENANT-DEFAULT`; `sha256 22797feab2a13c88546b96288652451c8224a4aea2d3f5b17cb71375103e5f37` |

Freshness proof:

- after: `source_template_id=5990d7b2-b198-43bd-90f0-ecd846f7726e`, `file_id=cfe6df1b-1037-4cfb-916a-160fc2ddde80`, `updated_at=2026-09-21 05:00:15.953+00`

### Fallback

Removing both the client override and the tenant assignment rendered the standard template on the portal with no `SMOKE-2528` marker and the preview still complete (`Invoice Details`, line items, `$200.00` total). Fallback ordering (standard → first available → unavailable) is also covered by `ClientInvoicePreview.templateSelection.test.tsx` and `invoiceQueries.templateResolution.db.test.ts`.

## Reproducing the PDF bytes

The PDF was captured in the MSP browser pane by wrapping `URL.createObjectURL`, clicking `#invoice-download-pdf` (no `templateId` in the URL), and reading the captured `Blob` back as base64 via `browser-eval`; the bytes were written locally and text-extracted with `pdftotext`.

- Case A artifact: `/tmp/2528-caseA-msp-fresh.pdf` (`sha256 72577be1…`)
- Case B artifact: `/tmp/2528-caseB-msp-fresh.pdf` (`sha256 22797fea…`)
- Screenshots: `/tmp/ghostty-pane-ide/screenshots/2528-caseA-portal-override.png`, `2528-caseA-msp-override.png`, `2528-caseB-portal-tenant.png`, `2528-caseB-msp-tenant.png`

## Fixture cleanup

After validation, all fixtures were removed and the dev data restored:

- deleted both `SMOKE 2528` templates;
- deleted the tenant-scope `invoice_template_assignments` row;
- set Emerald City `clients.invoice_template_id` back to `NULL` (its pre-smoke value, which was already `NULL`);
- restored `documents.source_template_id` for `94bf39b4-…` to its pre-smoke value `98da0e3a-…` (the working PDF bytes/file id remain the app-refreshed render; that refresh is the app's own download behavior);
- restored the `glinda@emeraldcity.oz` (MSP) and `ozma@emeraldcity.oz` (portal) password hashes to their pre-smoke values.

Verified after cleanup: 0 fixture templates, 0 tenant assignments, client override `NULL`, one invoice document association.

## Limitations

- The MSP *Download PDF* path reuses a frozen client-visible issued copy when one exists. This invoice had none, so the download rendered fresh — proven by the `source_template_id` transition above. On an invoice with a frozen issued copy, the download intentionally preserves that earlier artifact and should not be used for current-settings comparison.
- The client portal download serves the published document when present; it was not used to assert current-settings equality.
- The comparison is content-level (marker present on all three surfaces), not pixel-identical rendering parity, which the plan lists as out of scope.
