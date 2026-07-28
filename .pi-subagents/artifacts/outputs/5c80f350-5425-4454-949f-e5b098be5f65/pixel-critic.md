# PixelCritic Roast: Credit Management (/msp/billing/credits)

Viewport basis: 1474×~770 (adr-active.png). Job of screen: see client credit + expiry, issue, manage, reconcile. Verdict: ~60% of the first viewport is chrome, apology banners, and read-only settings before a single credit row appears. Worst first.

---

## 1. Two permanent skeleton cards squatting on the bottom of the page — pure dead pixels

`CreditsPageClient.tsx` renders "Credit Expiration Summary" and "Credit Usage Trends" cards whose entire content is `<Skeleton className="h-40 w-full" />` — hard-coded, not a loading state (visible as gray slabs behind the dialogs in view-dialog2.png / edit-dialog.png / expire-dialog.png). Each card ≈ half page width × ~300px incl. header → **~1,300 × 300px ≈ 390,000 px² of guaranteed-forever gray**, plus a lying description ("Historical credit usage patterns" — there are no patterns, there is a placeholder). A `Skeleton` is a promise of content; shipped as the final state it's an admission the section doesn't exist.

**Cut:** delete both cards outright. When the feature is built, bring it back. A "Credit Expiration Summary" would also be redundant with the Expires column sorted ascending — so even the planned content is questionable.

## 2. ~460px of stacked chrome before the first data row

From top of adr-active.png, the user pays: Back-to-Credits button (~50px) → "Credit Management" H1 (~70px) → "Credits Overview" CardHeader + filler description (~90px) → Credit Expiration Settings panel (~155px) → tab bar (~48px) → "3 columns hidden" banner (~48px) = **~460px, 60% of the viewport, to show 2 rows.** Layer-by-layer:

- **"Back to Credits" button on the Credits page.** The sidebar already has "Credits" highlighted; the label says "Back to Credits" while you are on Credits. Dead chrome — cut it.
- **"Credits Overview" card chrome.** The CardTitle repeats the H1 one inch below it; the CardDescription ("Manage your client credits, including expiration dates, and transfers") describes nothing and advertises "transfers" that don't exist anywhere on the page. Cut the Card wrapper entirely — tabs directly under the page header.
- **Tab trio that is one table wearing three hats.** Active / All / Expired use identical columns and the identical `CreditsList` component; Active ∪ Expired = All. That's three tabs restating one dataset. One table with a Status segmented filter (or just keep "Active" as default view with a filter chip) kills two full tab bodies of duplicate chrome.

## 3. Credit Expiration Settings panel: three read-only facts taxed at full-width × 155px on every tab

A muted mini-panel inside the Overview card displaying "Enabled / 365 days / 30, 7, 1" — with **no edit control**. It's a settings *display* that changes roughly never, sits above all four tabs, and its facts are re-derived per row anyway: every Expires value in all-credits-units.png is exactly Created + 365 days (6/11/2026→6/11/2027, 7/15/2026→7/15/2027, 7/27/2026→7/27/2027). The same fact is thus on screen twice simultaneously, and one rendering of it is arithmetic the user can do.

**Cut/merge:** compress to a single inline line in the (remaining) header — "Expiration: 365 days · notify 30/7/1 · Edit" with a gear opening a dialog. Frees ~155px × full width on every tab. And stop pretending it's "Settings" if you can't set anything there.

## 4. "N columns hidden. Show all" — a full-width purple banner apologizing for the table's failure

adr-active.png and all-credits-units.png: "3 columns hidden. Show all"; recon-units.png: "2 columns hidden". At 1474px the table hides **Remaining, Expires, and Status — literally job #1 of the screen** ("how much, when it expires"). The banner costs ~48px to announce the breakage instead of the layout preventing it. The hidden columns aren't missing for lack of room; the room is being burned by columns #5–#7 below and by a ~200px Actions column of three text buttons per row.

**Cut:** remove the banner by removing the need for it — drop Credit ID and Created (below), merge Original/Remaining, collapse Actions to a menu. The remaining 5 columns fit easily at this width.

## 5. Credit ID column: 8 truncated monospace characters identifying nothing

`render: value.substring(0, 8) + '...'` — "47c4fa12...". A truncated UUID prefix is not human-meaningful; nobody scans or speaks in 8-hex-char prefixes, and the full ID is in the View dialog (view-dialog2.png) for the one support case that needs it. It earns a permanent column why? It doesn't — it's the first thing the responsive logic hides anyway ("1 column hidden" in the dialog screenshots).

**Cut:** delete the column. If an identifier must exist in-row, it's the invoice number (already in the dialog), not a UUID stump.

## 6. Created column: Expires minus a constant

With the 365-day default, Created carries **zero bits of information** not already implied by Expires — the screenshots prove it: Created is Expires − 1 year in every single row. Two date columns to express one date.

**Cut:** keep Expires (job-relevant: "when does it expire"), drop Created into the View dialog.

## 7. Description column: truncated past readability

"Credit issued from negative i…", "Project deposit credit from in…" (all-credits-units.png). Truncated-to-unreadable text is decoration, not information; the full string is restated in the View dialog's Related Transactions table anyway.

**Fix:** either let it wrap/use the freed width from cuts #4–#6, or cut the column and let the dialog own it. Current state is the worst of both.

## 8. Original Amount vs. Remaining: two columns, one fact

Every visible row in every screenshot has Original = Remaining ($18/$18, $2,000/$2,000, $25/$25, $100/$100). When equal — the common case for fresh credits — one column is a photocopy of the other.

**Merge:** one "Balance" column rendering `Remaining`, with `of $X` appended in muted text only when different. The same duplication recurs in the Edit dialog ("Credit Amount: $25.00 / Remaining Amount: $25.00") and Expire dialog — show Remaining only; Original is irrelevant to both actions.

## 9. Actions column: three labeled buttons × every row ≈ 200px × row height of repeated chrome

View / Edit / Expire on every row (adr-active.png). "Edit" edits exactly one field (expiration date). "Expire" is a destructive action given equal visual weight and permanent adjacency to "Edit" — one misclick from a confirm dialog. Text-labeled buttons in every row is the lazy default.

**Collapse:** row click = View; one kebab menu with Edit expiration / Expire (destructive styling, separated). Frees ~150px of column width — more than enough to un-hide Remaining/Expires/Status (#4).

## 10. Reconciliation tab: the same numbers rendered three times down the page

recon-units.png / ReconciliationTab.tsx:

- **4 stat cards restate the table beneath them.** Open 1 / In Review 0 / Resolved 1 are counts of the very rows the table lists (the table has 2 rows; a whole ~270×80px Card exists to say "In Review: 0"). "Total Discrepancy -$43.00" is the sum of the Discrepancy column already displayed. **~110px × full width (~160,000 px²) spent pre-computing arithmetic on 2 rows.**
- **Expected / Actual / Discrepancy columns: Discrepancy = Expected − Actual, restated.** Screenshot row: -$68.00 / $0.00 / **-$68.00** — three columns, two facts. Show "Expected → Actual" in one cell with the colored delta, or drop Expected/Actual into the drawer.
- **Status exists in three places simultaneously:** stat cards, Status filter dropdown, Status badge column. Pick two (filter + column); the cards die.
- **Filter row redundancy:** "Select Client" label + "All Clients" placeholder is double labeling; the Reset button clears exactly two selects that both already have `allowClear` — a button whose entire job is duplicating two ×'s. Cut Reset, cut the labels (placeholder is the label), and the button copy "Run Reconciliation (All Clients)" echoing filter state back at the user is a third restatement — "Run Reconciliation" suffices; scope is obvious from the filter.

**Merge:** one compact summary line above the table — "1 open · 0 in review · 1 resolved · -$43.00 total" as inline text in the filter bar — and reclaim the entire stat-card row.

## 11. Reconciliation drawer: fourth rendering of the same three numbers

ReconciliationReportDetail.tsx re-displays Expected / Actual / Difference as two big colored boxes plus a full-width Difference box — after the stat cards (#10), after the table row the user clicked (#10). The same -$68.00 has now been on screen four times. Then "Discrepancy Details" re-shows Report ID (UUID, mono — the Credit ID mistake again) and Detected (already a table column). Then each fix panel's description is duplicated verbatim into the fix Dialog (`getFixDialogDescription` repeats the panel copy), and the Impact Summary restates Current/New balance a fifth time.

**Cut:** one balance line ("Expected -$68.00 → Actual $0.00 · Δ -$68.00"), delete Report ID field (or truncate to the dialog-only detail), delete duplicate dialog descriptions, keep Impact Summary only (it's the one rendering tied to a decision).

## 12. View dialog's Related Transactions restates the row you clicked

view-dialog2.png: the dialog shows Original $25 = Remaining $25, Created 2026-06-11, Expires 2027-06-11 (the 365-day echo again), then a Related Transactions table whose single row is "Credit issued from negative invoice SMK-CN-1 / 2026-06-11 / $25.00" — i.e., Description + Created + Amount from the parent table, third rendering. Also "Status: Active" as plain text duplicating the tab you were standing on. The dialog's job is the UUID, the invoice link, and the transaction ledger — make it do only that.

---

## Space audit summary

| Waste | Approx. pixels |
|---|---|
| Skeleton cards (permanent) | ~390,000 px² |
| Pre-table chrome stack (460px × ~1,180px) | ~540,000 px² of first viewport before data |
| Settings panel (per tab view) | ~180,000 px² |
| Stat cards vs. 2-row table (recon) | ~160,000 px² |
| Hidden-column banners | ~55,000 px² per table |
| Duplicate columns (ID, Created, Original, Discrepancy) | ~25–30% of every table's width |

Conservatively **over half the pixels on this screen restate, apologize for, or placeholder information available (or promised) elsewhere.** The screen's actual jobs — client, amount, expiry, issue, reconcile — fit in one table of 5 columns and one compact recon view.

*Code grounding: CreditsPageClient.tsx (skeleton cards, settings panel, columns, tabs), ReconciliationTab.tsx (StatCard grid, Expected/Actual/Discrepancy columns, Reset/allowClear duplication), ReconciliationReportDetail.tsx (balance boxes, duplicated descriptions, Impact Summary).*
