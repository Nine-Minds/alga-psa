# Implementation plan — Inventory dashboard redesign ("money before lunch")

- Slug: `2026-07-06-inventory-dashboard-ui`
- Date: 2026-07-06
- Branch: `improve/inventory-dashboard-ui`
- Status: Approved design, ready for implementation
- Mockup: [`2026-07-06-inventory-dashboard-ui-mockup.html`](./2026-07-06-inventory-dashboard-ui-mockup.html)
  — the approved hybrid, composed from three candidate options. Screenshots:
  [top](./2026-07-06-inventory-dashboard-ui-mockup-top.png) ·
  [bottom](./2026-07-06-inventory-dashboard-ui-mockup-bottom.png). **The implementer
  must open the mockup HTML in a browser (or study both screenshots) before writing
  any component code — it is the composition spec's source of truth.**
- Design language: [`docs/ui/design_guidelines.md`](../ui/design_guidelines.md) —
  every tile must pass its "new tile/panel" checklist. Build on
  `packages/ui/src/components/bento/BentoTile.tsx`; reference implementation
  `packages/tickets/src/components/ticket/bento/`. The mockup uses standalone CSS —
  translate its hierarchy into the token/type system, do not copy its raw hex values.

## Summary

Rebuild the `/msp/inventory` dashboard (`packages/inventory/src/components/InventoryDashboard.tsx`)
around the persona-validated principle: **"stop building a warehouse screen and build a
'what's going to cost me money before lunch' screen."** The layout is a hybrid of three
candidate designs, approved 2026-07-06:

1. **Money band** (three hero tiles): Unbilled but shipped · Margin MTD with the cause ·
   Vendor-owed RMA credits with aging.
2. **Exception stream** (left, dominant): one severity-ranked, filterable "Needs attention"
   worklist where every row names the client/tech/vendor, carries a mono dollar/age, and
   ends in a verb action.
3. **Right rail**: This week's deployments (readiness bars) · Sales-order pipeline funnel ·
   Receiving today · Ghost usage this week by tech.
4. **Footer strip**: demoted "inventory health" vanity stats (total value + WoW delta,
   on-hand units, dead stock flag, week activity).

Straight replacement, no feature flag. The rebuild also ports the dashboard off its
pre-guidelines raw-hex styling (~39 violations of the "tokens only" rule) onto
`BentoTile` + semantic tokens.

Design provenance: round-2 interview with the "Sam Delgado" MSP-owner persona (round 1 is
in `ee/docs/plans/2026-07-01-inventory-review-remediation/SCRATCHPAD.md` §Persona review).
His ranking drove every placement: money+names first, execution queues second, physical
readiness third, vanity stats demoted.

## Decisions (settled in design review)

| Question | Decision |
|---|---|
| Composition | Hybrid: exception stream engine (option C) + money-first hero band (option A) + cutover-readiness tile (option B) |
| Rollout | Straight replacement of `InventoryDashboard.tsx`; no flag, no layout toggle |
| Component system | `BentoTile` + design-guidelines tokens; delete the component's ad-hoc hex palette |
| Data flow | Keep the existing single-action pattern: extend `getInventoryDashboardData` (one `withAuth`, one transaction), page stays `force-dynamic` RSC |
| Severity model | Extend `AttentionItem` with `band: 'red' \| 'amber' \| 'info'` and `category: 'money' \| 'fulfillment' \| 'field' \| 'ops'`; stream renders three band sections; filter chips filter client-side |
| "Staged" bucket | Display language only — "staged" = `stock_units.status='allocated'`; "provisioned" = allocated AND `mac_address IS NOT NULL`. No new stock state, no migration |
| Cutover/install date | Reuse `sales_orders.expected_ship_date` (exists, nullable). SOs without it don't appear in the deployments tile |
| Ghost-usage dollars | Heuristic estimate (see D3), always labeled "est." |
| Snooze rules | Out of v1 — the mockup's "Snooze rules" link is dropped |
| PoE/port math | Out — the mockup's "injectors match ports" chip generalizes to per-line staged/backordered/on-hand chips only |
| Role-aware variants | Out — one screen serves owner/ops/tech via ranking, not per-role dashboards |
| Migrations | None required |

## Data-derivation decisions

- **D1 — Deployment readiness.** Candidate SOs: status IN (confirmed, partially_fulfilled)
  AND `expected_ship_date` within the next 7 days (tenant-qualified, top 3 by date).
  Per SO: `ordered` = Σ line qty_ordered; `done` = Σ qty_fulfilled; `staged` = count of
  `stock_units` with `allocated_so_line_id` in the SO's lines; `provisioned` = staged AND
  `mac_address IS NOT NULL`; `backordered` = Σ max(qty_ordered − qty_fulfilled − allocated, 0)
  over lines that have an open linked PO line (`purchase_order_lines.source_so_line_id`),
  with the PO's `expected_date` surfaced as the feeder ETA. Readiness % =
  (done + staged) / ordered. **AT RISK** when any feeder PO `expected_date` is ≥
  (`expected_ship_date` − 1 day) or past due; READY at 100%; otherwise STAGING.
- **D2 — Price creep → open quotes/SOs.** Current cost basis per product = preferred
  `vendor_products.unit_cost` when present, else `product_inventory_settings.average_cost`.
  Flag (a) `quote_items` on open quotes (status IN draft, pending_approval, approved, sent)
  whose stored `cost` < current basis, and (b) unfulfilled, non-cancelled
  `sales_order_lines` whose `cost_snapshot` < current basis. Margin at risk =
  Σ (current − stored) × outstanding qty. Feeds the margin tile's callout AND one amber
  stream row per affected document type.
- **D3 — Ghost-usage estimate.** Per-tech counts from the existing ghost funnel
  (`lib/ghostUsage.ts` already returns `closed_by_name`/`assigned_to_name`; attribute to
  `closed_by`, falling back to `assigned_to`). Dollar estimate = (median `ticket_materials`
  value per ticket across *billed* tickets on the report's configured boards, trailing 90
  days) × ghost count, rendered with an explicit "est." qualifier. When no billed baseline
  exists, omit the dollars and show counts only — never fabricate a number.
- **D4 — Unbilled & shipped tile.** Three itemized lines: (a) shipped-not-invoiced SO
  dollars from the existing F085b line-level query, grouped per SO with client name, top
  SO named, remainder rolled up; (b) confirmed drop-ship lines not yet invoiced (same
  query filtered `fulfillment_type='drop_ship'`), count + total; (c) ghost-usage est.
  from D3. Tile headline = a + b + c.
- **D5 — "In play today" header stat.** Σ of dollar amounts on red-band stream rows +
  unbilled total; "N items need attention" = stream row count. Both computed server-side
  in the same payload.
- **D6 — New stream sources** (beyond the six existing attention queries): overdue loaners
  (`stock_units` status `on_loan`, `loan_due_at < now()`, with client + unit cost); counts
  pending approval (`count_sessions` status `review`, with net variance dollars from lines);
  vendor-bill price-creep flags (reuse F090 per-line variance, bill-level rollup); at-risk /
  staging cutovers (from D1); price-creep documents (D2); ghost usage by top tech (D3);
  dead stock (D7). Existing six keep their queries and gain band/category tags.
- **D7 — Dead stock.** Per location: value of non-serialized `stock_levels` rows
  (qty × average_cost) whose service has **no** `stock_movements` row touching that
  location in 90 days, plus `in_stock` serialized units received >90d ago with no movement
  since. One info row + footer flag showing the worst location. Cap the query with the
  same tenant-qualified join idioms as `writeOffReport`.
- **D8 — Van shortages × today's jobs.** Existing low-stock query scoped to van locations;
  for each shorted van with an `assigned_user_id`, count today's `schedule_entries` for
  that user (via `schedule_entry_assignees`, any work-item type) → "N installs today".
  In-transit replenishment: open `stock_transfers` (status `dispatched`) targeting the van,
  surfaced as the row's subtitle ("transfer dispatched 7:02a · in transit").
- **D9 — Pipeline funnel.** Four stages: open quotes (count + Σ total from `quotes`,
  status IN sent, pending_approval, approved — products only is NOT required; quote total
  is fine), booked SOs (open SO count + outstanding value — extend `openSosWidget`),
  fulfilling (SOs with any fulfilled-but-not-invoiced or backordered line; flag "N blocked
  on backorder"), invoiced this week (Σ SO-linked `invoice_charges` in the last 7 days).

## Composition spec (mirror the mockup exactly; classes per design guidelines)

**Page header.** Title "Inventory"; subtitle `3 branches · 7 vans · N techs — **N items
need attention**, $X in play today.` (counts real; drop the "Managed by" clause — the
mockup's Denise line was persona flavor). Keep both header buttons and their links.

**Money band** — 3 equal hero tiles (grid `lg:grid-cols-3`, stack on mobile):
1. *Unbilled but shipped* — red left-accent treatment; headline dollars; 3 itemized rows
   (severity-dot, label + linked name, mono amount right); footer link "View revenue
   ledger →" → `/msp/inventory/margin` (or the ledger page the implementer finds fitting;
   must be a real route).
2. *Margin MTD* — headline % with delta vs last month (needs a prior-month margin query —
   same MTD query shifted one month); margin/rev/COGS meta line; amber callout box for
   price creep (D2) with linked SO/quote names; hidden when no creep found.
3. *Vendor-owed (RMA credits)* — headline dollars + "oldest Nd" chip; up to 3 aged rows
   (vendor linked, RMA id mono, age chip color-stepped ≥30d amber ≥45d red, amount mono);
   footer "Chase all RMAs →" → `/msp/inventory/rma`.

**Main grid** — `lg:grid-cols-[1.4fr_1fr]`, stream left, rail right.

*Needs attention stream* (one `BentoTile`, headerless list body): header row with title,
"N urgent" chip, filter chips (All · Money · Fulfillment · Field · Ops — client-side
state, no URL params). Rows grouped under three eyebrow section labels:
"Costs money or a customer today" (red band), "Worth chasing this week" (amber),
"Keep an eye on" (info). Each row: severity dot, category chip, one-line
`<name> — <fact>` (name is a real link: client → client detail, SO → sales order, tech →
ghost-usage review, vendor → RMA manager, van → stock page filtered), second meta line
(ids mono, dates), right column mono dollar/age, one compact action button with a verb
(Invoice, View SO, Track transfer, Recall, Review, Chase, Open staging, Re-quote,
Review bill, Approve, Reorder, View). Buttons navigate; they do not mutate inline in v1.
Footer: "Ranked by dollar + customer impact · refreshed <relative>" + "Full exception
log →" is **dropped** unless a real target exists — link instead to nothing (omit).
Empty state per band; fully-empty stream shows the guidelines' quiet empty sentence.

*Right rail*, top to bottom:
1. *This week's deployments* — per D1, up to 3 rows: client (linked to SO), weekday+date,
   `T-n` mono chip, status badge (AT RISK red / READY green / STAGING purple), readiness %
   (Poppins-weight numeral), two-tone progress bar (filled = done+staged; hatched amber
   segment = backordered share), meta line "`24× <product>` — 18 staged · 6 backordered",
   amber feeder note when at risk: "Fed by PO-XXXX <vendor>, ETA <date> — <slack>."
   Footer "All service orders →" → `/msp/inventory/sales-orders`. Tile hidden when no
   dated SOs exist (rail collapses up).
2. *Sales-order pipeline* — D9 funnel: headline $ + "N open SOs"; four labeled bars with
   right-aligned mono values; "N SOs blocked on backorder" warn line; "All SOs →".
3. *Receiving today* — count + $ headline, "N more this wk" meta; top 3 POs (id linked,
   vendor, mono amount); red flag row when a feeder PO lands within 1 day of its SO's
   `expected_ship_date` (from D1): "PO-XXXX lands today, 1 day before <client> cutover —
   no slack."; "Receive stock →" → `/msp/inventory/stock`.
4. *Ghost usage this week* — headline count + "est. $X" (D3); one explainer sentence;
   per-tech chips "Name · N · $est"; "Review ghost usage →" → `/msp/inventory/ghost-usage`.

**Footer strip** — single full-width quiet tile, hairline-separated inline stats:
on-hand value + WoW delta (green ▲ / red ▼), units on hand + serialized, dead-stock flag
(amber, location + age, only when D7 finds any), week activity (received/deployed/
transfers/RMAs), right-edge "Valuation report →" → `/msp/inventory/margin` or counts page.
WoW delta needs a "value 7 days ago" computation: value from current levels minus net
movement value over 7 days (reuse ledger deltas; document the approximation in code).

**Removed from the current dashboard** (deliberate, per persona): the 4-tile KPI ribbon
(inventory value / on-hand / on-order / margin as bare numbers), the standalone vendor
bills widget (its overdue/price-creep facts become stream rows; keep a "Review bills"
action there), inventory value by location (demoted to footer + dead-stock flag), recent
stock movements feed (the ledger link in the unbilled tile covers it), this-week 2×2 grid
(demoted to footer). The receiving queue survives as the rail tile.

## Work breakdown

**Phase 1 — data layer** (`packages/inventory/src/actions/inventoryDashboardActions.ts` +
new `packages/inventory/src/lib/dashboardQueries.ts` if the action file gets unwieldy):
- Extend `InventoryDashboardData`: `header_stats {attention_count, in_play_today}`,
  `unbilled {total, so_line {client, so_id, so_number, amount, shipped_at}, dropship
  {count, amount}, ghost {count, amount|null}}`, `margin_mtd` gains `prev_month_pct` +
  `price_creep {at_risk_amount, quotes: [...], so: [...]}` (nullable), `rma_receivables
  {total, oldest_days, rows[]}`, `deployments[]` (D1), `pipeline` (D9), `receiving_today`
  (existing receiving queue + flag fields), `ghost_week` (D3), `footer {value, value_wow_delta,
  on_hand, serialized, dead_stock|null, week_activity}`, and `attention[]` rows gain
  `band`, `category`, `amount_cents|null`, `age_days|null`, `action {label_key, href}`.
- New/extended queries per D1–D9. Every join tenant-qualified (copy idioms from the
  existing action); money stays integer cents; single transaction preserved.
- Update the stale header comment (file cites "design §10/§11"; the widget spec lives in
  design §8 / PRD §9).

**Phase 2 — components** (`packages/inventory/src/components/dashboard/` new directory;
`InventoryDashboard.tsx` becomes a thin composition):
- `MoneyBand.tsx` (3 hero tiles), `AttentionStream.tsx` (+ `attentionRow.tsx`),
  `DeploymentsTile.tsx`, `PipelineTile.tsx`, `ReceivingTile.tsx`, `GhostUsageTile.tsx`,
  `FooterStrip.tsx`. All on `BentoTile` where the tile shape fits; the money band's hero
  treatment may extend it (follow how `BentoHero.tsx` diverged for tickets).
- Token-only styling; lucide icons; all existing `id=` attributes preserved where
  equivalents exist (automation/tests target them) and new stable ids added per row/action.
- Client component only where interactivity demands (filter chips); keep the rest server-
  rendered from the single payload.

**Phase 3 — i18n**: every new string through `useTranslation('features/inventory')`;
add keys to all 8 locales (follow the F-series i18n commits' structure). No hardcoded
English. Numbers/currency through the existing formatters.

**Phase 4 — tests + verification**:
- DB-harness tests (vitest, `packages/inventory` T-series pattern) for each new query:
  D1 readiness math incl. at-risk edge (ETA = ship-date − 1), D2 creep detection with
  vendor_products vs average_cost fallback, D3 median + no-baseline omission, D6 loaner
  overdue + count variance, D7 dead-stock 90d boundary, D9 funnel counts.
- `npx tsc --noEmit` clean in server + packages.
- Browser smoke on this worktree's dev stack (start as `PORT=3404 npm run dev` — the PORT
  env var must be inline; `server/.env.local` PORT is ignored by the dev script): seed or
  reuse demo data so every band renders non-empty at least once; screenshot for the PR.
  Verify all stream action links land on real routes; verify empty states by filtering.

## Non-goals

- Snooze/dismiss rules for stream rows (needs per-tenant persistence — follow-up).
- Role-aware dashboard variants; per-user tile arrangement.
- PoE/port-count math or any phone-system-specific readiness chip.
- New REST/public API surface; mobile/camera flows; activity-feed integration.
- Changing `getInventoryDashboardData`'s auth/permission model (`inventory:read` stays).

## Acceptance / definition of done

- Dashboard matches the mockup's composition and hierarchy on a 1280–1600px viewport
  (allowing token-palette color differences), and degrades to single-column stacking.
- Zero raw hex / `text-gray-*` in the new components; guidelines checklist passes.
- All new dashboard facts are real queries — no placeholder or hardcoded values; ghost
  dollars render only when D3's baseline exists.
- Every named entity on the screen links to its owning page (client, SO, PO, RMA, tech,
  van/location, bill, count session, quote).
- DB test suite green (including new tests), tsc clean, browser smoke done with evidence.
- Features/tests tracking + SCRATCHPAD updates if the lane's conventions require them.
