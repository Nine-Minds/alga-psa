# Contract invoice adjustment repair handoff

## Scope

The repair derives automatic contract-change descriptions from canonical companion ledger values for both preview and new settlements. Coverage starts at `mid_period_effective_date` and ends at the half-open `adjustment_period_end`; the full adjustment period start remains unchanged in financial/provenance fields. Invoice read models can enrich source-linked existing rows from that ledger without writing back to invoices or export batches. The client portal treats a date-only value and a UTC-midnight ISO serialization of a PostgreSQL `date` as the same calendar day; other timestamps keep local instant formatting.

No delivered invoice, ledger row, or Xero batch was updated. `INV-000063` (`0df8a287…`), revision `a695a1bf…`, true-up `7d61786a…`, charge `a5d74891…`, and Xero batch `dc022057…` remain protected history and were not used as fixtures.

## Automated evidence

- Contract change description and projection suites: **10 passed**, including safe fallback for an invalid `Date` effective-date value. The invoice projection verifies October 1 period start plus October 13 effective date renders October 13–November 1. Earlier baseline description/invoice adapter suites had 29 passes.
- Portal date suite: **3 passed under `TZ=UTC` and 3 passed under `TZ=America/New_York`**, covering date-only, PostgreSQL `Date`, serialized UTC-midnight ISO, and a genuine timestamp input.
- Server infrastructure true-up regressions: **4 passed** for January 16 increase and decrease descriptions, October 13 / 19-of-31 preview and persisted increase, read-time invoice rendering enrichment of a stale source-linked description without DB mutation, and repeat reconciliation identity/amount with retained manual-line totals. The October established amount is 18,388 cents and remains unchanged.
- Accounting export matrix: **5 passed** across the supported adapters, including Xero and Xero CSV. The isolated October fixture uses adjustment period October 1–November 1 and effective date October 13; it checks the Xero adapter projection and serialized `LineItems[].Description` against the same 19/31 customer explanation. It preserves the settled net amount. Transport is mocked and does not prove provider acceptance.
- Billing package typecheck and build: **passed** after the effective-date changes. Server typecheck passed with `NODE_OPTIONS=--max-old-space-size=12288 npx tsc --noEmit -p server/tsconfig.json`. Client portal typecheck previously passed; its `tsup` build has no configured entry files and exits `No input files`.
- Server production build was attempted using the previously successful constrained settings: `NEXT_BUILD_CPUS=1`, `NODE_OPTIONS=--max-old-space-size=12288`, and a private `NEXT_DIST_DIR`. After about 15 minutes, webpack remained in cache serialization / disk-I/O state at roughly 14 GB RSS while host memory and swap were under pressure. The attempt was stopped (exit 143); build completion is not demonstrated.
- A focused DB suite attempt first hit its 20-second migration setup timeout; rerun with an isolated config completed the Xero and Xero CSV cases successfully. The config is temporary and is not part of the repair.

## Browser acceptance still required

The repair session did not start or use an app server. Once a reviewer-authorized dev environment is available, create new owned contract/revision fixtures (one increase, one decrease), each with an October 1–November 1 adjustment period, October 13 effective date, and 19/31 covered fraction. Generate the draft, then compare preview text and persisted row text: `Cabling: increase (+1 units)` / `Cabling: credit (-1 units)`, October 13 through November 1 (exclusive), `USD $120.00`, and `19/31 days`; verify the saved signed amounts remain +$73.55 and −$73.55 and retries keep the same revision/charge identity and manual lines. Inspect the actual generated PDF text/content and client portal invoice details. Export the same fixtures through the Xero simulator and inspect serialized invoice line descriptions and amounts. Repeat portal viewing with browsers configured to UTC and America/New_York and confirm `2026-10-13` displays as October 13 in both.

Use disposable invoice/contract fixtures only. Do not edit or regenerate `INV-000063`, its recurring periods or canonical revision, or delivered Xero batch `dc022057…`. A mocked Xero request verifies payload serialization only; the simulator run remains pending.
