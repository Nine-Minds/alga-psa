# Authenticated invoice adjustment smoke — 2026-10-07

Worktree HEAD at smoke: `caa30958aafb8bc98a77c57aca6cdbf15f687ef0` (test/evidence-only changes on top of the feature implementation).

## Environment and authentication

- Board-owned service `dev-server :19`, cwd `server/`, saved command unchanged. Under temporary Draft Implementation service-use permission, command-free `workflow-ensure-service --name=dev-server` returned `created:false`, the saved command/cwd, readiness `{port:3185,path:"/api/health"}`, and the readiness URL. `GET :3185/api/health` returned HTTP 200 `{"status":"ok","version":"1.0.0"}`.
- The first authenticated dashboard compile exposed missing `normalize-wheel` in local `node_modules` although it is declared in `package-lock.json`. Installed it with `npm install --no-save --ignore-scripts normalize-wheel@1.0.1`, restarted through the board, then the health endpoint and authenticated dashboard returned successfully. No tracked package manifest/lock changes resulted.
- Provisioned one temporary internal user and a temporary role with only invoice read/update, billing read/update, client read, and service read permissions (six unique permission pairs; nine existing permission rows due duplicate catalog entries). The password was generated and hashed with the application's `hashPassword`, then used through the normal MSP credentials form and NextAuth credentials callback. The login succeeded and the session resolved to the intended tenant. The user and role are scheduled for cleanup below; credential material is not committed or recorded here.

## Owned invoice and observed state

The UI path was **Billing → Invoicing → Drafts**. The synthetic draft `SMOKE-ADJ-CURRENT-20261007` (`5a1e0000-0000-4000-8000-202610070001`) was cloned from generated draft `INV-000039`, including its three recurring charge rows and canonical charge details. It was opened through the invoice list and the real `Invoice adjustments` editor. The screenshot [invoice-adjustments-after-repeat-save.png](screenshots/invoice-adjustments-after-repeat-save.png) shows the current live UI and the generated rows in its read-only Automated Line Items section.

All money values below are persisted minor units (cents), before tax; tax remained zero.

| State | Subtotal / total | Revision | Charge rows | Observation |
| --- | ---: | ---: | ---: | --- |
| Initial owned clone | 390000 / 390000 | 0 | 3 | Three generated charges: 150000, 40000, 200000 |
| Saved manual charge | 405000 / 405000 | 1 | 4 | Separate manual $150 row; generated rows unchanged |
| Saved manual 10% discount | 364500 / 364500 | 2 | 5 | Manual discount is -40500 ($405) against the $4050 base |
| Saved additional $1 charge | 364590 / 364590 | 3 | 6 | Discount reconciled in place to -40510 ($405.10) |
| Reload + two repeat saves | 364590 / 364590 | 5 | 6 | No duplicate charge rows; sum of net charge amounts 364590; no `transactions` rows posted |

The after-repeat query also confirmed the manual $150 charge, the $1 charge, and the `-40510` discount remain single rows. Shared invoices were checked before and after and retain their recorded values: `INV-000039` 390000/rev0, `REVIEW-CONTRACT-3499` 405000/rev20, and `SMOKE-ADJ-1` 370500 subtotal / 371400 total / rev63.

## Limits and cleanup

The invoice PDF action persisted an app-generated document. Its exact bytes were captured from tenant storage, saved as [SMOKE-ADJ-CURRENT-20261007.pdf](SMOKE-ADJ-CURRENT-20261007.pdf), and checked with `pdfinfo`/`pdftotext`; [pdf-text.txt](pdf-text.txt) records the invoice lines, -$405.10 discount, and $3,645.90 subtotal/total. Targeted cleanup removed the generated document/external-file metadata, session, user, and role after invoice cleanup. Follow-up DB checks confirmed owned rows absent and shared invoice values unchanged.

QuickBooks/Xero CSV downloads, manual-line edit/removal, partial-period descriptions and permanent-change focus, delivered-export edit blocking, and prohibited lifecycle UI states were not completed. Automated QBO/Xero adapter assertions passed with four discount-classified lines and signed-total parity; Xero transport is mocked and is not provider acceptance.

`fixture-cleanup.sql` removes only the owned draft, its charge/detail rows, and any invoice transaction rows for the exact synthetic ID/number. The temporary smoke user/role is removed after sign-out. Shared invoices and shared credentials are untouched. The normal board policy is restored to Draft Implementation with no `dev-server` dependency and Smoke Test with `dev-server`; registration `:19` is retained, suspended by policy, and not concluded.
