# Make the Co-managed IT seat pool screen explain itself

2026-11-22 · Approved by Robert from the mockup (`mockup.html` beside this file; the card carries it as `co-managed-mockup.png`, and the screen as it is today as `co-managed-current.png`).

## Problem

The sponsor overview at `/msp/co-managed` shows three zero tiles, a field labelled "Total seats in your pool" holding a bare `1`, and a small "Buy co-managed seats ↗" link in the corner. A first-time MSP administrator cannot tell what co-managed IT is, that seats are bought on this screen, what the `1` means (it is the new pool total, the purchase quantity), what it costs, or what to do next.

## Outcome

An administrator who has never heard of co-managed IT can read the page, understand what it is and who needs a seat, choose a quantity, see the price, and start the purchase review — and, once seats are owned, see how the pool is used and change its size knowing exactly what will change.

## The screen

Build to the mockup. It is a guide to content and hierarchy; use the standard AlgaPSA UI components and theme, not the mockup's CSS.

### Page header (both states)

Subtitle explains the product:

> Co-managed IT lets a client's own IT staff work alongside your team in AlgaPSA — on the same tickets, with access limited to their company. Each client technician uses one seat from a pool you buy here.

### A · Before the first purchase (purchased seats = 0)

The three count tiles are not shown. One card, two columns:

- **How it works**, three numbered steps: 1) Buy seats — one shared pool for the whole MSP, changeable at any time. 2) Turn on co-managed IT for a client — from the client record, choosing how many seats that client gets. 3) Their technicians sign in — each uses one seat and sees only their own company's work.
- **Who needs a seat?** "Only your clients' technicians. People who just submit tickets are free, and your own technicians are covered by your AlgaPSA licences."
- **Buy co-managed seats** box: "You have no seats yet."; label "How many seats do you want?"; a numeric stepper (minimum 1); the live recurring price beside it ("$X per month", "N seat(s) × unit price"); primary button **Review purchase**; hint "Nothing is charged until you confirm on the next step."

### B · Once seats are owned

- Title **Co-managed seats**, with the who-needs-a-seat line beneath.
- Tiles: Purchased / Allocated to clients / Available, with a usage bar (allocated ÷ purchased).
- A line stating how many seats are free to allocate and where ("Open a client record to assign them"), with a link to Clients. Show the link only to actors who may open clients.
- **Change the number of seats**: the stepper holds the new total; beside it the change is spelled out — a badge "Adding N seats" / "Removing N seats", "5 → 7 seats", the new monthly total and the difference. Primary button **Review change**, enabled only when the total differs from the purchased count.
- The corner link reads **Manage billing** and goes where "Buy co-managed seats ↗" goes today. The old link label is removed: the button on the page is the purchase.

## Rules

- One name for the thing: **co-managed seats**. Replace "customer technician seats" and "customer seats" in this surface's copy.
- Prices come from the existing purchase preview for the configured Stripe price, in its currency, through the standard currency formatting. Never hard-code an amount (the mockup's $25.00 is a placeholder). If the price cannot be read, show the quantity control and review button without a price rather than a wrong one, with the existing `previewError` handling at review.
- The purchase and review flow, its actions, operation recovery (resume, awaiting verification, pending capacity), grace/read-only notices and all access rules are unchanged. This is presentation and copy over the existing editor (`CoManagedPoolEditor`, `CoManagedUpgradePurchase`); see `ee/docs/plans/2026-11-18-co-managed-first-seat-purchase/PRD.md` for those rules. Existing states (resume purchase, pending purchase, checkout expired, needs admin, purchasing unavailable) keep working and must still have a visible place in both layouts.
- The quantity semantics stay "new pool total" underneath; only the presentation makes the change explicit.
- The same editor is shown in Account Management: it gets the clearer quantity row (label, stepper, price, change summary, button) but not the how-it-works explainer.
- All new copy goes through the locale files (`msp/licensing`), every supported locale, following the repo's translation rules. Respect the Pro/EE boundary the surface already has.

## Acceptance

- With zero seats, the page shows the explanation, how-it-works steps, who needs a seat, a labelled quantity stepper with live price, and a Review purchase button; no bare unlabelled number and no zero tiles.
- Choosing a quantity and pressing Review purchase opens the existing review with that quantity and the same amounts as before this change.
- With seats owned, tiles and usage bar show verified capacity; changing the total shows "Adding/Removing N", old → new, and the price difference before review; the button is disabled when nothing changed.
- Reducing below the allocated count is refused as it is today, with a message that says why.
- Resume, awaiting-verification, pending-capacity, expired, needs-admin and unavailable states each still render correctly in the new layout.
- No string on the surface says "customer technician seats" or "customer seats".
- Light and dark themes, and a narrow viewport (columns stack), look right.
- Review guide shows before/after screenshots of state A and state B.
