# GapCritic: Credit Management (/msp/billing/credits) — Omission Roast

Scope: what the screen DOESN'T do but must, worst-first. Every gap is grounded in a named job, an existing capability (cited), or a table-stakes UX state. Net-new-backend items are quarantined under "Proposals" at the bottom.

---

## P0 — Core job unserved at real scale

### 1. The credits table silently discards 96% of the data. Job 1 dies at 21 credits.
`CreditsPage.tsx` calls `listCredits(clientId, includeExpired)` with defaults `page=1, pageSize=20`. The server action `listClientCredits` (creditActions.ts:1303) faithfully returns `{credits, total, page, pageSize, totalPages}` — and the client's `CreditsListResult` type in `CreditsPageClient.tsx` **only declares `credits`**. Total and totalPages are fetched, serialized across the wire, and thrown away. The `DataTable` is rendered with **no pagination props at all** — in the same codebase where `ReconciliationTab.tsx` passes `pagination / currentPage / onPageChange / pageSize / totalItems` to the identical component. So the pattern, the server capability, and the component API all exist; somebody just didn't wire them. At 500 credits the operator sees the first 20 with **zero indication** that 480 exist. Job 1 ("see which clients hold credit, how much") is not degraded at scale — it is *falsified* at scale, silently.

**Minimal fill:** widen `CreditsListResult` to carry `total/totalPages/page/pageSize`, hoist page state, pass the pagination props to `DataTable` exactly as `ReconciliationTab` does. No server work needed.

### 2. The "Expired Credits" tab is a client-side filter over the truncated page — a lie squared.
`CreditsPageClient.tsx`: `expiredCredits = allCredits.filter(c => c.is_expired)`. `allCredits` is page 1 of 20 (see #1). So the Expired tab shows only the expired credits that happen to fall in the first 20 rows of "all" — at 500 credits it's essentially random. Worse, `listClientCredits` already accepts `includeExpired` as a server-side filter; the correct shape (a server-driven expired query or a status filter param) is one argument away.

**Minimal fill:** falls out of #1 if pagination is wired per-tab with server fetch; at minimum, don't derive a tab from a truncated page.

### 3. No client search/filter on the credit tables. Job 1 unserved for the multi-client operator.
The server side is already built: `listClientCredits(clientId, …)` takes a client filter as its first argument, and `CreditsPage.tsx` already reads `?client=` from searchParams. `fetchClientsForDropdown` (reconciliationReportActions.ts:90) exists and is used *on this same page* in the Reconciliation tab. Yet Active/All/Expired tables offer no client picker — the operator who wants "Cool Cars' credits" must eyeball-scan an unpaginated list. The capability inventory is complete; the UI just never asks.

**Minimal fill:** client `CustomSelect` filter above the credits table (reuse `fetchClientsForDropdown` and the existing `searchParams.client` plumbing), pass `clientId` into both `listCredits` calls.

### 4. Credit transfer: engine built, wrapper built, copy promised, UI absent. Job 3 incomplete.
`transferCredit` (creditActions.ts:1758) is a full engine — validates source credit, target client, sufficient remaining, writes the transfer. `transferCreditToClient` (components/credits/actions.ts:163) is a finished UI-ready server-action wrapper with error mapping and `revalidatePath`. A grep for `transferCreditToClient` across `packages/` returns exactly **one hit: its own definition**. Nothing imports it. Meanwhile the page copy *advertises* the feature: "Manage your client credits, including expiration dates, and transfers." The screen promises transfers in prose and delivers them nowhere. This is the single clearest "capability present but unsurfaced" case on the page.

**Minimal fill:** "Transfer" row action (active credits with `remaining_amount > 0`) opening a dialog: target `ClientPicker` (the exact component `AddCreditButton` already uses), amount input capped at remaining, optional reason, submit → `transferCreditToClient`. The dialog also needs an impact line (source remaining before/after) — see #9.

---

## P1 — Information the job needs that the screen already has but won't show

### 5. A fully consumed credit displays "Active" and offers "Expire". Job 1 ("how much") misrepresented.
`getStatusLabel`: `is_expired` → Expired; no `expiration_date` → Active; ≤7 days → Expiring Soon. A credit with `remaining_amount = 0` and no expiration date renders as a healthy blue "Active" — indistinguishable from a live $2,000 credit. The row still offers Edit and Expire actions, and the engine *rejects* that expire ("Cannot expire a credit with no remaining amount" — mapped in components/credits/actions.ts) — so the UI walks the operator into a guaranteed error. The data to fix this (`remaining_amount`) is already rendered in the adjacent column.

**Minimal fill:** add a "Depleted"/"Fully Used" status when `remaining_amount <= 0` (muted/grey); suppress the Expire action on such rows (and arguably Edit→expiration is still fine).

### 6. Per-client aggregate balance is nowhere. The reconciliation "actual" (`clients.credit_balance`) is invisible on this screen.
Job 1 is "which clients hold credit, **how much**" — per client, not per row. The only per-client totals on the entire screen appear in the Reconciliation tab as `expected_balance`/`actual_balance`, and only when a discrepancy report exists. An operator asked "how much credit does Mountain Dental hold?" must mentally sum table rows (the first 20, per #1). The sum-of-remaining is derivable from data already fetched; the ledger `credit_balance` is the field reconciliation itself treats as ground truth.

**Minimal fill:** when a client filter is applied (per #3), show a summary strip: total remaining across the client's active credits + `clients.credit_balance`, so drift is visible *before* reconciliation flags it. At minimum, aggregate the fetched rows.

### 7. Resolved reconciliation reports hide the audit. Job 4: resolution is a write-only memory.
`ReconciliationReportDetail.tsx` renders `resolution_date` and `resolution_notes` for resolved reports — but `ICreditReconciliationReport` (billing.interfaces.ts:580) also carries `resolution_user` and `resolution_transaction_id`, and neither is rendered anywhere. The fix actions create real adjustment/tracking transactions; the operator reviewing a resolved report cannot see **who** resolved it or **which transaction** the resolution wrote. "Review the reconciliation history" (the resolved-state copy) is an invitation to a room with no furniture.

**Minimal fill:** render `resolution_user` (resolve to display name) and link `resolution_transaction_id` to the transaction/credit detail. Both fields are already on the fetched report object.

---

## P2 — States and decisions

### 8. Two permanent skeleton cards occupy prime page real estate forever.
"Credit Expiration Summary" and "Credit Usage Trends" render `<Skeleton className="h-40 w-full" />` unconditionally — not a loading state, a *final* state. The Expiration Summary is worse than decorative: it's *computable from data already on the page* — `allCredits` rows carry `expiration_date`, the status logic already buckets "Expiring Soon (≤7 days)", and the settings panel shows `credit_expiration_notification_days` (e.g. 30/7/1) with nothing attached to those numbers. The screen knows which credits expire inside each notification window and refuses to count them.

**Minimal fill:** fill "Credit Expiration Summary" with counts + amounts expiring within each configured notification window, derived from the fetched credits (or a grouped query if #1's pagination makes client-side derivation wrong). "Credit Usage Trends" needs history it doesn't have — that's a Proposal (below): either build it or delete the card; a permanent skeleton is the one unacceptable option.

### 9. Expire is a blind decision about blast radius; transfer dialogs don't exist to be blind.
`ExpireCreditDialog` does show original + remaining and says the balance "will no longer be available" — partial credit. But the decision the operator is actually making is "client X's total credit balance drops by $remaining" and the dialog never shows the client's balance before/after. Contrast: the reconciliation fix dialog *does* have an Impact Summary (current → new balance) — the pattern exists in this very feature area and wasn't applied to the destructive per-credit action. And when #4's transfer dialog is built, it must show source-remaining before/after or it repeats the same sin.

**Minimal fill:** add an Impact Summary block to `ExpireCreditDialog` (client balance now → after forfeiting remaining), mirroring the reconciliation fix dialog. Client balance is available via the same query paths reconciliation uses.

### 10. Page-level refresh/loading state is absent; filter-empty copy doesn't exist because filters don't.
The credits tables are server-fetched; after Add Credit / Edit / Expire, `router.refresh()` re-renders with no in-flight indicator — the operator stares at stale rows and wonders if the click worked (the toast says yes, the table says nothing). The dialogs themselves are fine (`isSubmitting`/`isExpiring`/skeletons in `AddCreditButton`, `ExpireCreditDialog`, `CreditDetailDialog` — credit where the states exist). Once #1/#3 land, "zero results for this client/page" needs copy distinct from "no credits exist" — currently only one empty string (`management.noCreditsFound`) serves both.

**Minimal fill:** a loading indicator bound to refresh/pagination transitions (the Reconciliation tab's skeleton-over-table pattern is already on the page), plus a filtered-empty message ("No credits match this client") when a filter is active.

---

## Proposals (net-new backend or another surface — NOT iteration asks)

- **Credit Usage Trends card**: needs a time-series over credit transactions that no current action returns aggregated. Either build the analytics query or remove the card; don't ship a skeleton.
- **Expiration notification delivery visibility**: settings promise notification days (30/7/1) but nothing shows whether notifications fired. That's notification-engine surfacing, likely belongs in settings or a notification log, not this table.
- **Bulk operations** (bulk expire, bulk transfer): real at scale, but net-new batch engine surface; out of scope for filling this screen's existing promises.

---

## Verification notes (manual)

- Read: `CreditsPageClient.tsx`, `CreditsPage.tsx`, `components/credits/actions.ts`, `AddCreditButton.tsx`, `CreditDetailDialog.tsx`, `ExpireCreditDialog.tsx`, `ReconciliationTab.tsx`, `ReconciliationReportDetail.tsx`.
- Grep: `transferCreditToClient` → single hit (definition only); `listClientCredits` signature confirms `{credits,total,page,pageSize,totalPages}`; `ICreditReconciliationReport` confirms `resolution_user`/`resolution_transaction_id` exist; `fetchReconciliationReports`/`fetchClientsForDropdown` confirmed in `reconciliationReportActions.ts`.
- Screenshots `adr-active.png` / `adr-recon.png` confirm: no filter/pagination chrome on credits tables; copy "...and transfers"; settings panel with notification days and nothing consuming them; reconciliation tab has the filter/pagination/stats the credits tables lack.
