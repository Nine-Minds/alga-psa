# Voice Critic: Credit Management (/msp/billing/credits)

Ranked worst-first. Every quote is verbatim from `server/public/locales/en/msp/credits.json` or the component `defaultValue`s. Screenshots confirm rendering.

---

## 1. The custom-adjustment flow lies about units — this is a data-corruption bug wearing copy

`ReconciliationReportDetail.tsx`:
- Field label: **"Adjustment Amount"**
- Hint: **"Enter a positive amount to increase the balance or a negative amount to decrease it."**

The code prefills the field with `report.difference.toString()` — raw **minor units** (`-4300` for the -$43.00 row in the screenshots), and computes the new balance as `report.actual_balance + parseFloat(customAmount)`, also minor units. So the input is in **cents**, and the copy never says so. Every other amount on this screen is dollars formatted via `formatCurrencyFromMinorUnits`. Worse: the **Add Credit** dialog on the same page has a field also labeled **"Amount"** that takes **dollars** (`type="number" step="0.01"`, converted with `toMinorUnits`). One screen, one noun, two units, zero disclosure. A user who types `-43` to fix a $43.00 difference corrects the balance by **43 cents**, the Impact Summary confirms the wrong number back to them formatted as currency, and they click "Apply Fix" believing it.

→ Rewrite label: **"Adjustment (cents)"** — or better, fix the input to dollars like its sibling dialog and label it **"Adjustment amount ($)"** with hint **"Positive adds credit, negative removes it."** Until the unit is honest, no phrasing saves this.

## 2. Dead copy kept alive by a test that only asserts keys exist

These strings sit in the shipped locale file (and are translated into 8 languages) but **no component renders them** — the only references are `packages/billing/tests/CreditsLocaleSmoke.i18n.test.ts`, which checks the keys exist:
- **"Credit amount and details form would be implemented here."** (`management.addCreditPlaceholder`) — a developer note shipped to production locales.
- **"View and manage your client credits. Credits stay financial artifacts, and recurring service periods appear only when the source invoice carried canonical coverage."** (`management.recentCreditsDescription`) — "financial artifacts" and "canonical coverage" are pure schema-speak.
- **"Credit Reconciliation Dashboard"** (`reconciliation.title`), **"Reconciliation Reports"**, **"View and manage credit balance discrepancies"**, the entire `charts.*` block.

→ Delete the keys, delete the smoke-test assertions for them. Unearned copy that only a test can see is still unearned.

## 3. One concept, three names: Reconciliation / Validation / Discrepancy / Difference

- Button: **"Run Reconciliation (All Clients)"**
- Success toast: **"Validation completed: Found {{balanceCount}} balance discrepancies and {{trackingCount}} tracking issues."**
- Grid column: **"Discrepancy"**
- Drawer field for the same number: **"Difference"**
- Stat card: **"Total Discrepancy Amount"**

Four terms for one event, and the toast swaps the verb the button just used. The toast also splits results into "balance discrepancies" vs "tracking issues" — an engine taxonomy the user never asked for.

→ Pick **"balance check"** for the action and **"difference"** for the number. Button: **"Check All Clients"** / **"Check Balances"** (kills the banned parenthetical too). Toast: **"Found {{count}} balance differences."** Grid column: **"Difference"**, matching the drawer.

## 4. Issue-type labels are table names

- **"Missing Credit Tracking Entry"**
- **"Inconsistent Credit Remaining Amount"** (drawer H2, screenshot-confirmed)
- **"Credit Balance Discrepancy"**

"Tracking entry" is the `credit_tracking` table leaking. "Inconsistent" is a diff-algorithm adjective. And the drawer fields double down: **"Report ID"**, **"Transaction ID"**, **"Credit ID"** render full raw UUIDs (`1047015b-292d-4fe3-9e0f-739dbfbf4977`) as user-facing facts.

→ **"Credit record missing"**, **"Remaining amount doesn't match"**, **"Balance doesn't match"**. Drop Report ID and Transaction ID from the UI entirely; link the Credit ID to the credit.

## 5. The Add Credit dialog narrates its own plumbing

**"Issues a prepayment invoice and finalizes it, making the credit immediately available to the client."** (`addCredit.description`)

"Prepayment invoice" and "finalizes" describe the two server actions the handler calls (`createPrepaymentInvoice`, `finalizeInvoice`) — implementation trivia, not user information.

→ **"The credit is available to the client right away."** One fact, no engine.

## 6. Card captions restating their titles

- **"Credits Overview"** / **"Manage your client credits, including expiration dates, and transfers"** — banned verb "Manage", a comma splice ("credits, including expiration dates, and transfers" misreads as a three-item list), and the tabs directly below demonstrate everything it says. Note the copy exists in two variants (`overviewDescription` / `overviewDescriptionWithExpiration`) just to keep this caption.
- **"Credit Expiration Summary"** / **"Overview of credits expiring soon"** — title says it; caption adds zero. (And the same pair is duplicated verbatim in the `charts.*` block — the same fact stated twice in one file.)
- **"Credit Usage Trends"** / **"Historical credit usage patterns"** — same disease.
- **"Modify Credit Expiration"** dialog / **"Update the expiration date for this credit."** — the description re-states the title.

→ Cut all four captions. Rename the dialog **"Edit Expiration Date"** — the button that opens it says **"Edit"**, and "Modify" is SaaS-speak for a verb the UI already chose.

## 7. "Total Discrepancy Amount: -$4,300.00" is a meaningless stat presented as fact

Screenshot `recon-fix2.png`: a +$2,500.00 row and a -$6,800.00 row sum to **-$4,300.00**. Signed cancellation across unrelated clients tells the user nothing — it reads as "you owe $4,300" or "credits are overstated by $4,300", neither true.

→ **"Open difference total"** summing absolute values, or cut the card.

## 8. Fix-panel boilerplate

Every fix option opens a dialog whose description restates the button, padded with "This will":
- **"This will create a new credit tracking entry for the transaction."**
- **"This will update the remaining amount in the credit tracking entry."**
- **"This will create a credit adjustment transaction to correct the balance."**
- **"This will create a custom credit adjustment transaction."** ("custom ... adjustment transaction" — three nouns deep)
- **"This will mark the discrepancy as resolved without making any changes."**

And the recommendations hedge instead of instructing: **"Apply the recommended correction to bring the balances back into alignment."** ("bring ... back into alignment" is consultant-speak), **"Enter a custom adjustment if a manual correction is required."**

→ Delete the tautological descriptions where the button already says it. Where a consequence needs stating: **"Adds the missing credit record for this transaction."**, **"Sets the remaining amount to the expected balance."**, **"Posts a credit adjustment of {{amount}}."**, **"Marks this resolved. No balance change."** Button: **"Resolve Without Changes"** instead of **"Mark as Resolved (No Action)"** — kill the parenthetical.

## 9. "Expire Credit" dialog buries the consequence in filler

**"This will immediately expire the credit. The remaining balance will no longer be available to the client. This action cannot be undone."**

"This will" opener, passive "will no longer be available", and the actual stakes (the dollar figure sitting right below: Remaining Amount $100.00) go unnamed. Placeholder **"Explain why this credit is being expired..."** is passive too.

→ **"The client loses the remaining $100.00. You can't undo this."** Placeholder: **"Why are you expiring this credit?"**

## 10. Term drift for the same credit fields

- Grid: **"Original Amount"** / **"Remaining"**; Edit + Expire dialogs: **"Credit Amount:"** / **"Remaining Amount:"**; View dialog: back to **"Original Amount"** / **"Remaining"**. Pick **"Original"** and **"Remaining"** everywhere; "Credit Amount" is redundant inside a dialog titled "Credit".
- Status cell: **"Expiring Soon ({{days}} days)"** — parenthetical plus "soon" doing the counting's job. → **"Expires in {{count}} days"** (also fixes the `{{days}}` vs `{{count}}` pluralization convention used elsewhere).
- **"Expiration Date (optional)"** → put "(optional)" out of its misery: leave the label **"Expiration Date"** and keep the hint. Hint itself: **"Leave blank to use the credit expiration settings for this client."** → **"Leave blank to use the default 365-day expiration."** — name the actual default.
- **"Notification Days: 30, 7, 1"** (settings panel, screenshot-confirmed) — cryptic label, cryptic value. → **"Remind before expiration: 30, 7, and 1 days"**.

## 11. Trailing colons and filler

- **"Credit Expiration:"**, **"Expiration Period:"**, **"Notification Days:"**, **"Credit Amount:"**, **"Remaining Amount:"**, **"Created:"**, **"Current Expiration:"**, **"Total Available Credit:"**, **"Invoice Amount:"** — colon-as-layout across two panels and three dialogs. Drop them; the layout already pairs label and value.
- **"No data returned from server"** — server-talk, and untrue from the user's chair. → **"Credits failed to load. Try again."**
- **"Reconciliation report not found. It may have been deleted or you may not have permission to view it."** — speculate less. → **"This report was deleted or you don't have access."**
- **"Failed to load reconciliation reports. Please refresh and try again."** — "Please" + two imperatives. → **"Couldn't load balance checks. Refresh to try again."**

---

## What's structurally missing (mandate check)

- The Reconciliation tab never tells the user what a "check" does before they run it — one line above the button (**"Compares each client's recorded credit against their transaction history."**) would earn the jargon the rest of the tab could then drop.
- The "3 columns hidden. Show all" banner (screenshots) hides **Remaining**, **Expires**, and **Status** — the three columns the screen's job statement requires — behind an unlabeled overflow with no copy explaining what was hidden. That's an information-architecture failure the copy "3 columns hidden" only papers over.
