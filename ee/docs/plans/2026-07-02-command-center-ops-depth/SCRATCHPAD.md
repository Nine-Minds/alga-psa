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

## Status
Plan drafted, not started. Identity-strip prerequisite shipped (91225b76c0).
