# PRD: QBO Closed-Loop Sync — Slice 3: Onboarding & Reconciliation

- **Status:** Draft
- **Owner:** Robert Isaacs
- **Created:** 2026-06-11
- **Design:** `../2026-06-11-qbo-phase2-closed-loop/design.md`
- **Depends on:** Slice 1 (engine, payment applier, mapping ledger); benefits from slice 2 but does not require it

## 1. Problem statement & user value

Nearly every tenant connecting QBO connects to an **established** company
file: customers, invoices, and payment history already live there. Today the
integration auto-provisions customers by display name on first export — which
duplicates "Acme Corporation" when Alga says "Acme Corp" — and offers no way
to link existing QBO invoices, so a re-export of history would double-book it.
Payments recorded before connecting never replay through CDC, so linked
history would read unpaid in Alga forever.

This slice makes first connect safe and deliberate: explicit customer
mapping with auto-match assistance, historical invoice linking without
export, a one-time payment-status backfill for matched history, and a
go-live cutoff that fences which invoices auto-sync.

## 2. Goals

- A customer mapping surface where every Alga client can be linked to an
  existing QBO customer, created in QBO on demand, or left for first-export
  auto-provision — with exact-name matches bulk-acceptable and fuzzy matches
  human-confirmed.
- A re-runnable first-connect wizard: customers → historical invoice matching
  (mappings written, nothing exported) → go-live cutoff.
- Matched historical invoices get a one-time payment backfill through
  `recordExternalPayment`, so their paid state and AR are correct from day one.
- The go-live cutoff guarantees connecting never sprays history into QBO:
  only invoices finalized after the cutoff auto-enqueue.

## 3. Non-goals

- Importing QBO customers as new Alga clients (link-only; creation flows
  Alga→QBO).
- Importing unmatched QBO invoices into Alga.
- Continuous two-way customer field sync (name/address propagation beyond the
  cached display name from slice 1).
- Multi-realm wizard flows (single/default realm this slice; realm picker
  arrives in slice 4).

## 4. Personas & primary flows

- **MSP billing admin (new connection):** completes OAuth, lands in the
  wizard. Accepts 40 exact customer matches in one click, reviews 6 fuzzy
  ones, links 200 historical invoices by doc number, opts into the payment
  backfill, sets go-live to today. First scheduled cycle exports nothing
  historical; the books simply agree.
- **MSP billing admin (established connection):** opens the Customers mapping
  tab to fix one mis-linked client, or re-runs the wizard from settings after
  a QBO file cleanup.

## 5. Functional scope

### 5.1 Customer mapping surface

- `getQboCustomers` server action (realm-scoped, cached like the existing
  catalog actions; EE + `billing_settings` read gated).
- A Customers tab in the live mapping manager — a bespoke component (the
  generic module pattern fits dropdown mappings; this needs match
  suggestions and per-row actions): each Alga client row shows its mapping
  state and offers *link to existing* (searchable QBO customer picker),
  *create in QBO now* (runs the company-sync adapter immediately), or *leave*.
- Auto-match: normalized display-name comparison (case, punctuation,
  whitespace, common suffixes like Inc/LLC folded). Exact matches →
  bulk-accept bar ("Accept N exact matches"); near matches → suggested but
  individually confirmed; everything else unmatched.
- Mapping writes go to `tenant_external_entity_mappings`
  (`alga_entity_type: 'client'`, realm-scoped), the same rows the exporter's
  customer resolution already consults.

### 5.2 Reconciliation wizard

- Launches after the first successful OAuth connect (no completed-wizard
  record for the realm); re-runnable from QBO settings. Steps:
  1. **Customers** — embeds the mapping surface (5.1) in wizard chrome.
  2. **Historical invoices** — fetch QBO invoices (paged), candidate-match
     against Alga invoices by doc number + total + (when mapped) customer.
     Confident matches are listed for one-click bulk link: mapping rows
     written with sync-token/total snapshot, **nothing exported**. Ambiguous
     candidates (number collision, total mismatch) go to a review list and
     are never auto-linked. Includes the **payment backfill** option
     (default on): for each linked invoice, query its QBO payments once and
     apply through `recordExternalPayment` (skipping invoices already
     `paid`), giving history real payment records and correct status.
  3. **Go-live cutoff** — set `auto_sync_start_date` (default today):
     the slice-1 finalize producer only enqueues invoices finalized on/after
     this date. Existing unexported invoices before the cutoff remain
     manual-batch only.
- Wizard completion recorded per tenant×realm; settings shows
  completed/last-run state next to the re-run entry point.

## 6. Data model & API notes

- Tenant settings: `auto_sync_start_date`, wizard completion record
  (per realm). No new tables — match candidates are computed live so the
  wizard is naturally idempotent and re-runnable.
- Slice-1 producer gains the cutoff check (one condition).
- QBO API surface: Customer query (paged), Invoice query by date window
  (paged), Payment query by invoice — all read-only additions to
  `QboClientService`.

## 7. Risks & open questions

- Name normalization quality drives the wizard's first impression; ship the
  folding rules with table-driven tests and keep "exact" strict (normalized
  equality only — similarity scoring stays suggestion-tier).
- Payment backfill volume: a tenant with years of history triggers many
  Payment queries — run inside the wizard as a progress-reporting batch, not
  in the 15-minute cycle.
- Doc-number matching assumes Alga invoice numbers were used in QBO
  historically; where they weren't, matching legitimately finds nothing —
  the wizard must make "0 matches" a normal outcome, not an error.

## 8. Acceptance criteria / definition of done

- Features implemented; automated tests green; slice-1 suites unaffected.
- Live sandbox smoke against a pre-seeded QBO file (existing customers +
  invoices + payments): wizard links exact customers in bulk, links history
  without exporting, backfills paid status correctly, and a post-wizard
  finalize+cycle exports only the new invoice; re-running the wizard is a
  no-op.
