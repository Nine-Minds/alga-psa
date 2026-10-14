# Contract invoice adjustment repair handoff

## Scope

The repair derives automatic contract-change descriptions from the companion ledger for both preview and new settlements. Invoice read models can enrich source-linked existing rows from that ledger without writing back to invoices or export batches. The client portal treats a date-only value and a UTC-midnight ISO serialization of a PostgreSQL `date` as the same calendar day; other timestamps keep local instant formatting.

No delivered invoice, ledger row, or Xero batch was updated. `INV-000063` (`0df8a287…`), revision `a695a1bf…`, true-up `7d61786a…`, charge `a5d74891…`, and Xero batch `dc022057…` remain protected history and were not used as fixtures.

## Automated evidence

- Description, source-linked projection, and invoice adapter suites: **29 passed**.
- Portal date suite: **3 passed under `TZ=UTC` and 3 passed under `TZ=America/New_York`**, covering date-only, PostgreSQL `Date`, serialized UTC-midnight ISO, and a genuine timestamp input.
- Server infrastructure true-up regressions: **3 passed** for preview/persisted increase parity, signed decrease credit, repeat reconciliation identity/amount, and retained manual-line totals.
- Accounting export matrix: **2 passed** for Xero and Xero CSV. It enriches an old generic invoice description through the source ledger, checks the actual Xero adapter line and serialized `LineItems[].Description`, and preserves the settled net amount. Transport is mocked and does not prove provider acceptance.
- Billing package typecheck and build: **passed**. Client portal typecheck: **passed**. Its `tsup` build has no configured entry files and exits `No input files`.
- Server typecheck exhausted Node heap at both 4 GB and 8 GB without reporting type diagnostics. A fresh billing package typecheck after the final source edits passed. The isolated optimized server build remained at “Creating an optimized production build” after 10 minutes while its Next build process used about 21 GB RSS; it was stopped to avoid leaving work running. No server build result is claimed.
- A focused DB suite attempt first hit its 20-second migration setup timeout; rerun with an isolated config completed the Xero and Xero CSV cases successfully. The config is temporary and is not part of the repair.

## Browser acceptance still required

The repair session did not start or use an app server. Once a reviewer-authorized dev environment is available, create new owned contract/revision fixtures (one increase, one decrease), each with a 19/31 covered interval and a $120 full-period rate. Generate the draft, then compare preview text and persisted row text: `Cabling: increase (+1 units)` / `Cabling: credit (-1 units)`, the half-open interval, `USD $120.00`, and `19/31 days`; verify the saved signed amounts remain +$73.55 and −$73.55 and retries keep the same revision/charge identity and manual lines. Inspect the actual generated PDF text/content and client portal invoice details. Export the same fixtures through the Xero simulator and inspect serialized invoice line descriptions and amounts. Repeat portal viewing with browsers configured to UTC and America/New_York and confirm `2026-10-13` displays as October 13 in both.

Use disposable invoice/contract fixtures only. Do not edit or regenerate `INV-000063`, its recurring periods or canonical revision, or delivered Xero batch `dc022057…`. A mocked Xero request verifies payload serialization only; the simulator run remains pending.
