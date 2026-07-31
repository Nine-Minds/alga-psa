# Command Center Ops Depth (Sam Delgado batch)

## Problem

Persona review (Sam Delgado, MSP ops veteran — see SCRATCHPAD for full critique) found the
command center "weighted toward what's easy to count over what runs a service desk." The
customer-identity gap was fixed immediately (commit 91225b76c0). This plan covers the
operational depth: SLA, unbilled work, ticket ownership, warranty lifecycle, and the
mis-weighting cleanup.

## Scope (approved 2026-07-02)

In: items below. Out (own effort, needs data-model work): contract substance — MRR,
agreement type, renewal dates, block-hours remaining. `contracts` has no top-level end
date; renewal data must be modeled before it can be surfaced. Also out: scheduled-onsite
line, account-team roster, dispatch-grade site notes, client tier badge (revisit after
this batch).

## Workstreams

### W1 — SLA truth on the service surface (Sam #1)
- Feasibility gate first: determine what per-ticket SLA targets exist (`sla_policies` are
  already loaded by ClientDetails; check for per-ticket target/breach timestamps or a
  computable policy→ticket mapping). If targets are computable: attention flag
  `sla_at_risk` (breach within N hours) + `sla_breached`, and an SLA countdown on the
  service card's top tickets. If NOT computable, stop and report — do not fake it with
  due_date (D6 honesty).

### W2 — Unbilled work / WIP on the money card (Sam #3)
- `time_entries` (billable, not yet invoiced) summed for the client: "$X unbilled time
  (Y hrs)" line + `wip_aging` attention flag when unbilled entries older than 14 days.
- Unbilled materials (ticket/project materials without billed_invoice_id) same line.

### W3 — Ticket ownership (Sam #4)
- Assigned tech name on each service-card ticket row.
- `ticket_unassigned` attention flag (open tickets with no assignee), blue severity.

### W4 — Warranty & lifecycle on install base (Sam #6)
- `stock_units.warranty_expires_at` + asset warranty fields: "N out of warranty,
  M expiring ≤90d" line; click → equipment focus. Only when data present (many fleets
  have no warranty dates — show nothing, not zeros-as-insight).

### W5 — Mis-weighting cleanup (Sam's "actively wrong" list)
- CSAT card: collapse to a compact stat chip row unless it has ≥1 response.
- Client record card: drop tax region + inbound domains from the overview card (they
  remain in the Details focus view); add account manager prominence.
- Timeline: collapse per-invoice "drafted" noise — drafts already covered by strip +
  money card; keep `invoice_finalized` events, drop `invoice_created` for drafts still
  in draft (an invoice_created event whose invoice is currently draft duplicates the
  money card). Decision D-t1: filter at query time, keep type for finalized history.

## Acceptance

Every new number is a live query (D6 carries over). Attention flags only when true.
DB-backed tests extend clientPulse suite (WIP math, unassigned flag, warranty counts;
SLA per W1 outcome). Browser smoke on Emerald City. tsc + suites green.

## Lanes

W2/W3/W4 are pulse-action + card work → codex lanes against locked contract additions.
W1 feasibility + all UI → Claude. W5 → Claude (UI + one timeline query change, lane-safe
only after codex lanes land).
