# Scratchpad — command center ops depth

## Source
Sam Delgado persona review, 2026-07-02 (subagent). Full text in session transcript;
ranked: SLA > contract substance (DEFERRED, data-model gap: contracts has no top-level
end/renewal date) > unbilled WIP > ticket ownership > scheduled onsite (deferred) >
warranty/EOL > account team (deferred) > site dispatch info (deferred) > contact phones
(SHIPPED 91225b76c0) > tier badge (deferred).
Mis-weighted: CSAT oversized when empty; tax region/inbound domains on overview; draft
invoices shown in 3 places (strip + money card + N timeline entries).

## Verified schema facts (from command-center build)
- time_entries table exists (billing state columns TBD — verify before W2 brief).
- stock_units.warranty_expires_at exists. Asset warranty fields TBD (check assets table).
- tickets: assigned_to column TBD — verify exact name (ticket_resources table also exists
  for additional assignees).
- sla_policies loaded by ClientDetails via getSlaPolicies (cross-feature hook). Per-ticket
  SLA target columns: UNKNOWN — W1 feasibility gate first, do not assume.
- Attention flag plumbing: add kinds to ClientAttentionFlagKind + AttentionStrip labelFor.

## Feasibility gates + schema verification (2026-07-02, psql against dev DB)

- W1 GATE: **PASSES.** tickets carries full per-ticket SLA state: sla_policy_id,
  sla_response_due_at/_at/_met, sla_resolution_due_at/_at/_met, sla_started_at,
  sla_paused_at, sla_total_pause_minutes. calculateSlaStatus (ticket-columns.tsx:18-81)
  already interprets these (at-risk = ≥80% elapsed). Flags sla_breached + sla_at_risk are
  honestly computable from due/actual columns alone.
- W3: assignee column is `tickets.assigned_to` (uuid, users FK); assigned_team_id also
  exists. ticket_resources holds additional assignees — primary only for the card.
- W2: time_entries = billable_duration (minutes), invoiced (bool), service_id,
  contract_line_id, work_item_id + work_item_type, work_date. NO rate column — dollar
  value requires contract-line/service rate resolution → HONESTY DECISION: unbilled TIME
  is reported as hours + entry count (no invented dollars); unbilled MATERIALS are real
  dollars (ticket_materials + project_materials both have client_id, quantity, rate,
  currency_code, is_billed, billed_invoice_id, billed_at).
- W4: assets.warranty_end_date exists (used by MspClientAssets column);
  stock_units.warranty_expires_at confirmed earlier.

## Scope addition (2026-07-02): roast tier-1 gap fills folded in

Per ROAST-SYNTHESIS gap findings (grounded in existing capability):
- W6: Billing Dashboard AR strip — reuse getClientPulse().money (aging + outstanding
  already computed; no new action) + balance-due/status enrichment of
  getRecentClientInvoices (credit_applied + completed invoice_payments join).
- W7: Contacts list portal-access + role columns (getPortalInvitations /
  getUserByContactId already compute per-contact status; IContact.role already on rows)
  + a search input (scale gap).

## Lane plan (mirrors the command-center build)
- Me: contract-type lock + stubs; ALL UI (cards, strip labels, dashboard strip, contacts
  columns); W1 flag UI; W5 cleanup after lanes land.
- codex lane A: clientPulseActions.ts fetch additions (W1 flags + sla fields on top
  tickets, W2 WIP, W3 assignee/unassigned, W4 warranty counts) + clientPulse.test.ts
  additions. Owns exactly those two files.
- codex lane B (after A lands or parallel — different files): getRecentClientInvoices
  balance-due/status enrichment + its consumers' types. Owns packages/reporting file.

## Status
WAVE 1 SHIPPED (f60d876093): lane A (codex) + UI lane (Claude) + W5. clientPulse 8/8, clientTimeline 4/4.
W6/W7 SHIPPED: balance_due on getRecentClientInvoices + dashboard column (drafts show em dash);
contacts Role column + client-side search. DECLINED: duplicating the AR/aging strip inside the
dashboard (money card owns it — would recreate roast S4 redundancy); portal-access column
deferred until a batched per-contact source exists (per-row getPortalInvitations = N calls). Identity-strip prerequisite
shipped (91225b76c0). Roast loop pre-work: SLA column already surfaceable in client
tickets list (72c45e9ba3), warranty columns visible on assets (bac8cc01c9).
