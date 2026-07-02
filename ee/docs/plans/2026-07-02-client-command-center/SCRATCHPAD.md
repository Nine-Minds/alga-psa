# Scratchpad — Client Command Center

## Load-bearing recon facts (verified 2026-07-02 against dev DB + code)

- `ClientDetails.tsx` (packages/clients/src/components/clients/, 1861 lines) already builds
  `baseTabContent: {id,label,content}[]` (~line 1232) — the focus-view registry for free.
  Tab ids: details, tickets, assets, equipment (cond.), billing, billing-dashboard?, contacts,
  documents, tax-settings?, additional-info?, notes, interactions + EE hudu/passwords (verify
  exact id strings when wiring deep links — read the array, don't guess).
- ClientDetails has `quickView` / `isInDrawer` props — it is ALSO rendered as a quick-view
  drawer from other screens (quickView renders `[tabContent[0]]` only, ~line 1704). Command
  center must only replace the full-page path (D1).
- `?tab=` already read via `searchParams?.get('tab')?.toLowerCase()` (~line 1707).
- `packages/ui/src/components/Drawer.tsx`: Radix dialog, `width` prop ('90vw' ok),
  `hideCloseButton`, nested-dialog safe via InsideDialogContext + modal={false} when nested.
- Schema (all verified via psql):
  - invoices: due_date, total_amount, credit_applied, finalized_at, status, client_id,
    currency_code. Dev statuses seen: 'draft', 'Unpaid' (status strings are NOT canonical —
    use finalized_at IS NULL AND status='draft' predicate from invoiceQueries).
  - invoice_payments: payment_id, invoice_id, amount, payment_date, status — REAL writers:
    Stripe webhook (packages/integrations), EE PaymentService, QBO payment sync
    (recordExternalPayment). Dev DB: 0 rows (fine — aging shows all outstanding).
  - sales_order_lines: quantity_ordered, quantity_fulfilled, quantity_invoiced,
    quantity_reserved. sales_orders has NO total_amount column.
  - stock_units: client_id, status, delivered_at, received_at, warranty_expires_at.
  - rma_cases: client_id, status, opened_at, closed_at.
  - tickets: entered_at, closed_at, is_closed, due_date, status_id; statuses.is_closed.
  - comments: ticket_id, created_at, author_type enum = {internal, client, unknown}.
    Dev data has only internal/unknown → client-waiting flag will be invisible in dev until a
    client comment exists. Honest by construction.
  - interactions: client_id, interaction_date, title, type_id.
  - quote_activities: quote_id, activity_type, description, created_at (join quotes.client_id).
  - contracts: owner_client_id, status. Pricing lives across contract_line_* config tables →
    D7: no MRR, show active contract count.
  - audit_logs: EXISTS but EMPTY in dev — auditLog helper only wired to invoice/financial/auth
    paths, NOT ticket status transitions. So no time-in-status; overdue + client-waiting instead.
  - clients: notes_document_id (BlockNote doc) → no note timeline events (D6). created_at for
    "client since". account_manager_id.
  - No 'notes'/'client_notes' event tables. CSAT = survey_responses; ClientDetails already
    loads `surveySummary` — reuse, don't refetch in pulse.
- documents: via document_associations (entity_type='client'? verify exact enum when writing
  pulse — check existing documents-tab query in clients/documents package for the association
  shape and reuse it).

## Lane plan

- Wave 0 (Claude): plan artifacts, commandCenterTypes.ts, throwing stub actions, barrel exports.
- Wave 1 parallel:
  - codex A: clientPulseActions.ts (complexity ~6) + server DB-backed test clientPulse.test.ts
  - codex B: clientTimelineActions.ts (~6) + clientTimeline.test.ts
  - Claude (UI, per standing directive): ClientCommandCenter + cards + AttentionStrip +
    ClientTimelinePanel + FocusViewHost + ClientDetails restructure + deep links.
- Wave 2 (Claude): review diffs, run DB suites locally (codex sandbox can't reach :5432),
  full tsc (NODE_OPTIONS=--max-old-space-size=16384), browser smoke, flip flags, commit.
- Collision map: codex A and B each own exactly one new action file + one new test file.
  Claude owns everything under components/ + commandCenterTypes.ts + barrels. No overlaps.

## Decisions log

- D1..D9 in PRD. Notable: no feature flag; no migrations; no MRR; no note events.
- Attention flag labels built client-side from structured fields (i18n), not server strings.
- Timeline `id` = `${source}:${pk}` for stable cursoring; cursor = base64(occurredAt|id).

## Commands

- DB psql: `docker exec -e PGPASSWORD=$SP devstack_postgres psql -U app_user -d server`
  (SP from server/.env.local DB_PASSWORD_SERVER; host psql not installed).
- Server infra tests: export DB_PASSWORD_ADMIN/DB_PASSWORD_SERVER from server/.env.local first.
- Full tsc: `cd server && NODE_OPTIONS="--max-old-space-size=16384" npx tsc --noEmit -p tsconfig.json`.
- After heavy multi-package edits: RESTART dev server before browser smoke (stale server actions).

## Discoveries during build

- CustomTabs `TabContent = {id,label,content,icon?}` exported from
  `@alga-psa/ui/components/CustomTabs` — command center consumes it directly.
- ClientDetails tab ids are kebab-case lowercase ('billing-dashboard', 'tax-settings'…);
  AlgaDesk mode filters a fixed exclusion set from `baseTabContent` (~line 1555) — command
  center's `resolveTab(...preferred)` helper degrades gracefully when a tab is filtered out.
- `renderSurveySummaryCard({summary})` comes from `useClientCrossFeature()` — CSAT card slots
  into the grid unchanged (D7).
- Sales orders have NO per-SO deep link URL (SalesOrdersManager keeps `detailSoId` in local
  state) — SO refs link to the list page for now. FOLLOW-UP candidate: `?soId=` support.
- i18n: `useTranslation from '@alga-psa/ui/lib/i18n/client'`, namespace 'msp/clients'.
- UI files (Claude lane, wave 1): command-center/{ClientCommandCenter,AttentionStrip,
  PulseCards,ClientTimelinePanel,FocusViewHost}.tsx; ClientDetails integration = 1 import +
  handleFocusTabUrlChange + render branch (quickView/isInDrawer keep CustomTabs).
- packages/clients tsc clean after UI wave.

## Wave 2 review + verification (2026-07-02)

- codex A (pulse) design notes verified independently: default contact IS
  clients.properties.primary_contact_id (ClientDetails writes it); document_associations
  entity_type='client' confirmed in documents model; invoice_payments 'completed' status from
  EE migration 20251203120000. RMA terminal set in code = {closed, credited, charged}.
- codex A test bug fixed by me: comments seed used nonexistent is_initial_description →
  is_system_generated (NOT NULL). Suites: clientPulse 4/4, clientTimeline 3/3 (run locally;
  codex sandbox has no DB).
- codex B hardened by me: decodeCursor now rejects invalid dates (was unhandled RangeError);
  merge-sort tiebreak switched localeCompare → codepoint so JS ordering can't disagree with
  the SQL cursor predicate on same-timestamp rows.
- MY bug found in browser smoke: ?tab=equipment deep link dropped because Equipment joins the
  tab registry asynchronously (permission hook) — useState initializer decided too early.
  Fixed with consume-once effect in ClientCommandCenter (deepLinkConsumedRef).
- invoice_payments is an EE migration → clientPulse.test.ts self-provisions the table
  (standard test reset only runs server/migrations).
- Pre-existing clients-package test failures (NOT ours, verified via stash on clean tree):
  ClientDetails.quick-add-contact T014, inboundDestination T025, ContactPortalTab T029/T030.
- Browser smoke (EE, Emerald City): attention strip ($15,753 drafts / #TIC1003 3d / RMA 50d),
  aging bars = seeded $50/$100/$75 buckets, timeline 20→28 Load more with 28/28 unique,
  tickets + equipment focus views host legacy tabs unchanged, flag click routes through the
  /msp/invoices/{id} redirect to the Drafts subtab, URL hygiene on open/close.
- Dev demo data added for smoke: due_date -3d on one EC ticket; due_dates -10/-45/-75d on the
  three finalized EC invoices (INV-003/004/005).
- Final: clients tsc 0, full server tsc 0 (16GB heap), suites green.
