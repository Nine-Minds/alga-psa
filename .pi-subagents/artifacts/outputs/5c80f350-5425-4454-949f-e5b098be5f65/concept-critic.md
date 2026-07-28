# ConceptCritic Roast — Credit Management (/msp/billing/credits)

Ranked worst-first. Every claim is grounded in the files cited.

---

## 1. Two permanent skeleton cards shipping invented concepts (Credit Usage Trends, Credit Expiration Summary)

**The redundancy/invention:** `CreditsPageClient.tsx` renders a "Credit Usage Trends" card and (when expiration is enabled) a "Credit Expiration Summary" card. Both bodies are literally `<Skeleton className="h-40 w-full" />` — not a loading state, a *permanent* skeleton. There is no data fetch, no reader, no component behind either card. Grep for `usageTrends|UsageTrends|ExpirationSummary` outside locales hits only this file and two i18n smoke tests. "Historical credit usage patterns" is a concept the application does not possess — no aggregation action, no time-series reader exists anywhere in `packages/billing` or `packages/reporting`. The locale file still carries the abandoned mockup: `charts.creditsIssued/creditsApplied/creditsExpired` and a hardcoded `charts.months` jan–jun — six month names frozen in JSON, the fossil of a demo chart.

Worse, "Credit Expiration Summary" doesn't even need a new reader: the page **already fetches** `allCreditsResult` with `expiration_date` and `is_expired` per row, and the Status column already derives "Expiring Soon (N days)" client-side from that same column (`getStatusLabel`, ≤7-day window). The summary is a one-line `reduce` over data in hand — instead it's an empty gray box promising an "Overview of credits expiring soon" that never arrives.

**Evidence:** `CreditsPageClient.tsx` (the `grid grid-cols-1 md:grid-cols-2` block); `server/public/locales/en/msp/credits.json` `charts.*`; grep for backing readers returns nothing.

**Consolidation forced:** Delete both cards and the `charts.*` locale corpse. If "expiring soon" matters, it's a derived count chip above the table from the already-fetched rows — not a card, not a concept. Usage trends gets built when a real reader exists, and not one pixel before.

## 2. "In Review" — a status bucket with no transition into it

**The invention:** The reconciliation taxonomy is Open / In Review / Resolved, surfaced as a filter option (`ReconciliationTab.tsx` statusOptions), a badge branch (`reconciliationPresentation.tsx` `getStatusBadge`), and one of four stat cards ("In Review: 0" in `adr-recon.png` / `recon-units.png` — always 0, forever).

There is **no code path that writes `in_review`**. The model only ever sets `status: 'open'` at creation (`packages/reporting/src/models/creditReconciliationReport.ts:388`) and `status: 'resolved'` at resolution (`:345`). `creditReconciliationFixActions.ts` checks `report.status === 'resolved'` and resolves; no fix action, no server action, no API endpoint anywhere sets `in_review` — grep for the string across the repo finds only the type union, a zod enum, the migration comment, read-side filters, and the stats count. It's a migration-comment aspiration promoted to a first-class UI bucket. Three buckets, two real decisions (fix it / dismiss it — both land in Resolved).

**Evidence:** `grep -rn "in_review"` — zero writers; `creditReconciliationActions.ts` only *reads* `whereIn('status', ['open', 'in_review'])` for dedup matching; screenshots show the In Review card pinned at 0.

**Consolidation forced:** Collapse to Open / Resolved. Delete the stat card, the badge branch, the filter option. If triage-state is ever genuinely needed, add the transition action first, then the UI — in that order.

## 3. Active / All / Expired tabs restate the Status column — and don't even match it

**The redundancy:** The table has a Status column rendering three values: Active, Expiring Soon (N days), Expired. Directly above it, three tabs: Active Credits, All Credits, Expired Credits. Active ⊂ All; Expired ⊂ All. Two of three tabs are strict subsets of the third, and the tab vocabulary *disagrees* with the column vocabulary — "Expiring Soon," the one status a user might actually want to isolate (it's the only actionable one), has no tab. So the tabs are simultaneously redundant with the column and less expressive than it.

The structural cost is real: `CreditsPage.tsx` fires `listCredits(clientId, false)` **and** `listCredits(clientId, true)` eagerly on every page load to feed the Active and All tabs — two full paginated queries so a tab bar can pretend a boolean filter is navigation. The Expired tab then re-derives its rows client-side by filtering `allCredits` — a third representation of the same `is_expired` predicate, now in three places (SQL `where`, client `filter`, Status column render). Bonus incoherence: `listClientCredits` is paginated (page/pageSize/totalPages) but `CreditsList` discards all pagination metadata and renders the DataTable with no pagination props — the server paginates into a void.

**Evidence:** `CreditsPage.tsx` (double fetch); `CreditsPageClient.tsx` (`expiredCredits = allCredits.filter(...)`, tab construction); `creditActions.ts:1298–1400` (`includeExpired` flag, paginated return); `getStatusLabel` (the 3-state column).

**Consolidation forced:** One tab: Credits (plus Reconciliation, which is a genuinely different concept). One fetch (`includeExpired: true`). A status select filter over the column's own three values — including Expiring Soon, which the data already computes. Delete the double fetch and either wire the pagination through or stop pretending the query paginates.

## 4. Reconciliation table columns lie about units for two of three issue types

**The dishonesty:** The reports table shows Expected Balance / Actual Balance / Discrepancy for every row. But those columns are only truthful for `balance_discrepancy` reports. `validateCreditTrackingEntries` creates missing-tracking reports with `expected_balance: 0, actual_balance: 0, difference: 0` — three columns of meaningless zeros (the real amount hides in `metadata.transaction_amount`). `validateCreditTrackingRemainingAmounts` stores a *single credit's remaining amount* in fields labeled client "Balance" — `recon-units.png` shows "Expected Balance: -$68.00," a negative expected balance, which is nonsense read as a client balance. And the "Total Discrepancy Amount" stat card (`-$43.00` in `adr-recon.png`) sums `difference` across heterogeneous report kinds, adding client-balance deltas to per-credit remaining-amount deltas — a mixed-unit total presented with a dollar sign.

**Evidence:** `creditReconciliationActions.ts` (`expected_balance: 0, // Not applicable for this type of report` — the comment confesses); `ReconciliationTab.tsx` columns; `fetchReconciliationStats` (`getTotalDiscrepancyAmount`); screenshots.

**Consolidation forced:** The column set must follow the issue type: for tracking issues show Credit/Transaction + Amount; for balance issues show Expected/Actual/Difference. Either split the table by issue type or render per-type cells. Drop the aggregate money stat until it sums one unit.

## 5. Issue-type vocabulary is schema leak, not user language

**The leak:** "Missing Credit Tracking Entry" and "Inconsistent Credit Remaining Amount" are the names of internal failure modes of the `credit_tracking` ledger table, verbatim. No MSP billing user thinks "ah yes, an inconsistent credit remaining amount" — they think "this client's credit doesn't match what was used." The UI even pipes the raw snake_case through in places (`transaction_type` rendered with `replace(/_/g, ' ')` in `ReconciliationReportDetail.tsx`). And the third category is a fiction: `getIssueType` returns `'balance_discrepancy'` as the *fallback* for any metadata it doesn't recognize — a catch-all dressed up as a taxonomy peer.

**Evidence:** `reconciliationPresentation.tsx` (`getIssueType`, `getIssueTypeLabel`); `creditReconciliationActions.ts` metadata keys mirroring table/column names.

**Consolidation forced:** Rename to the user's model: "Credit not recorded" / "Credit amount doesn't match applications" / "Client balance doesn't match ledger." Make the fallback explicit ("Unknown issue") instead of laundering unrecognized data into a real-sounding category.

## 6. Credit Expiration Settings — a tenant-wide settings panel squatting inside a data card

**The misplacement:** A read-only display of billing *configuration* (Enabled, 365 days, notify at 30/7/1) sits inside the "Credits Overview" card, above the tabs, with no edit affordance — the page's Edit dialog edits per-credit expiration dates, not these settings. It's a different surface's concept (Billing Settings) duplicated as a dead readout. It also secretly *gates the information architecture*: `creditExpirationEnabled` decides whether the Expired tab and the Expiration Summary card exist at all, so a config toggle restructures the navigation. And provenance is fudged — `CreditsPage.tsx` passes a zero-UUID sentinel client so `getCreditExpirationSettings` silently falls back to tenant defaults, displaying inherited values as if they were page facts.

**Evidence:** `CreditsPageClient.tsx` (`CreditExpirationSettingsPanel`, `if (creditExpirationEnabled) tabs.push(...)`); `CreditsPage.tsx` (`clientId || '00000000-...'` with the fallback comment).

**Consolidation forced:** Move the settings readout (with an edit link) to Billing Settings where the concept lives. Never gate visible tabs on config — show the Expired tab whenever expired rows can exist. If the expiration policy must be visible here, it's a one-line caption ("Expiration: on, 365 days — edit in Settings"), not a panel.

---

### Summary of forced consolidation
The screen carries ~6 concepts for 4 jobs, and two of the six (usage trends, in-review) are pure invention with no backing write or read path. One credits table + one status filter + a reconciliation queue with honest per-type columns covers jobs 1–4. Everything else is a skeleton, a corpse, or a leak.
