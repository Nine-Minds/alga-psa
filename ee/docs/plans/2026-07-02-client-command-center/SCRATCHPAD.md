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

## Post-ship polish (2026-07-02, commits 44e0bcb167 + 66c30ff3a7)

- Aging chart: zero buckets rendered a 4px phantom bar (visibility floor applied to $0) —
  now no bar for empty buckets, axis baseline, exact-amount tooltips. Dollar values were
  audited against DB + billing Finalized tab: correct (tiny seed invoices INV-003/004/005).
- Preview-cap rules made consistent: counts never capped; previews capped with on-card
  acknowledgment. Draft invoices now capped at 5 server-side (DRAFT_INVOICE_PREVIEW_LIMIT)
  with a separate count+sum aggregate feeding the flag and "+N more" (ClientPulseMoney gained
  draftInvoiceCount). Locations preview (3) got its missing "+N more".

## Editability sweep (2026-07-02)

Verified every edit surface works on the command-center path:
- Details focus: full form (11 fields), END-TO-END SAVE verified (account manager →
  Glinda Good persisted to clients.account_manager_id via psql check).
- Manage Locations dialog (locations card): Add Location + per-location edit controls.
- Quick Add Ticket (service card): opens, client prefilled.
- Contacts focus: list + Add New Contact — NESTED dialog stacks correctly on the focus
  drawer (InsideDialogContext/modal=false path works). First open is slow in dev only
  (on-demand chunk compile) — looks like an infinite skeleton, isn't.
- Notes focus: BlockNote contenteditable mounts editable.
- Billing (General/Contracts/Tax Rates/Billing Contacts), Tax Settings, Additional Info,
  Interactions (Add Interaction), Documents (New/Upload/Link), Assets: all render with
  live controls inside drawers.
- FINDING+FIX: six tabs had NO UI entry point (billing, tax-settings, additional-info,
  notes, interactions, assets-when-equipment-present) — reachable only by ?tab= deep
  link. Added "All views ▾" menu on the identity row listing the full tab registry
  (ids client-details-cc-views-<tabId>).
- Quick-add ticket, locations dialog, delete + deactivate dialogs all mount OUTSIDE the
  quickView/command-center branch in ClientDetails, so they work on both paths.

## Hybrid nav: drawer rail + notes card (2026-07-02, replaces "All views ▾")

Robert judged the All views dropdown "not discoverable enough" → 2 mockups
(/tmp/client-cc-nav-{1,2}-*.html) → hybrid approved: option 1 (rail + contextual
links) + option 3's notes card.

- FocusViewHost gained the view rail (F037): renders the live `tabs` registry, so
  RBAC filtering + future tabs come free. Group map RAIL_GROUP_BY_TAB (unknown ids →
  "More" group — reachability guarantee for tabs the map doesn't know). Switching
  calls the same openFocus → in-place swap + ?tab= hygiene. Ids:
  `${idPrefix}-focus-rail`, `${idPrefix}-focus-rail-<tabId>`.
- "All views ▾" menu deleted from the identity row (F038); sweep note above about
  `-cc-views-<tabId>` ids is now historical.
- CardShell gained `footerLinks` (ids `${cardId}-link-<slug>`): Money → billing
  setup + tax settings; Record → additional-info; Install base → assets, gated on
  `tabIds.has('equipment')` so it never duplicates the header action (F039).
- Notes: `ClientPulseNotes` in pulse (always present, client:read only). fetchNotes
  reads document_block_content by clients.notes_document_id; extracts text from the
  first 2 non-empty BlockNote blocks (inline .text, link children one level down).
  Blank-but-saved docs → hasNotes:false, no timestamp (D6). NotesCard: amber-tinted
  preview + "edited Nd ago", empty state flips action label to "＋ Add note ↗".
- Browser smoke (Emerald City): menu gone; all 4 footer links live; rail lists 12
  tabs in 4 groups; billing→tax-settings in-place switch with URL following (URL
  lags clicks by ~2s in dev — router.replace transition, not a bug); note typed via
  BlockNote + Save persisted (psql-verified) and NotesCard rendered the preview
  after reload; ?tab=additional-info deep link opens with correct rail active state;
  close cleans URL.
- Suites: clientPulse 5/5 (new T005 notes). clients tsc 0, full server tsc 0.

## Roast iteration loop (2026-07-02, per adversarial-design-iteration skill)

Backlog + declines: ROAST-SYNTHESIS.md. One change / live-verify / commit each.
DONE (all pushed):
1. 69c386240d B1 cents fix — dashboard invoice totals were 100x (formatCurrencyFromMinorUnits
   + currency_code restored to getRecentClientInvoices).
2. cba4bed215 B2 locale fix — "Last updated: {{value}}" added in all 8 locales (fr keeps nbsp).
3. 4b6971f9ba S3a close guard — ConfirmationDialog on focus-drawer close when the record
   buffer is dirty (details/additional-info); discard actually resets editedClient.
   NOTE: kit has an unmounted UnsavedChangesContext engine (link-interception + beforeunload)
   — adopting it app-wide is a follow-up, deliberately not done here (blast radius).
4. a558e9c5b8 S3b tax settings — one deferred save model (was: exempt auto-save + certificate
   own-Save + settings Save); Save disabled until dirty.
5. 72d5d0b0de B3 error states — shared SectionLoadError (clients pkg) in dashboard 4x +
   equipment 3x; assets full-view error branch. Verified by sabotaging window.fetch POSTs
   live (note: rejected action POSTs wedge that page instance's action queue — reload before
   further server-action work after such a test).
6. 263e3c51f8 B4/B5 additional-info — parent = ClientPicker writing properties.parent_client_id
   (+name; legacy free-text hinted; Clear button; self disabled); last-contact-date field
   REMOVED (timeline is the source of truth; DatePicker option declined).
7. dd784187f0 S5a contacts — Edit opens ContactDetailsEdit in a drawer (was router.push);
   list row updates on save; dead router import removed.
Demo-data side effects: Dorothy Gale role set to "IT Director" (kept — matches People card).
8. bac8cc01c9 S1 column curation — equipment (MAC dropped, Asset link width-promoted),
   assets (Details column removed + renderAssetDetails deleted; Status/Warranty End moved
   ahead of Serial/Location/Purchase), dashboard invoices (Status 2nd, Total width-promoted
   rightmost, Invoice Date = drop candidate).
8b. 72c45e9ba3 tickets dispatcher preset — client-context visibility override (sla:true,
   board/category/created/created_by off), px width overrides for the triage set, SLA width
   STRIPPED (all shared ticket columns declare % widths → admission is declaration order;
   stripping demotes SLA below assignee/due), toolbar flex-wrap + flexible search.
   KEY MECHANIC (dataTableColumnFit.ts): width-bearing columns admitted first (declaration
   order among peers); % widths floor at natural size, px widths don't.
9. 8cca2914ac S1b width reclaim — interactions max-w-2xl removed (942px vs 672 capped);
   notes editor min-h 200px → 50vh. Both measured live.
DEFERRED with reason:
- S2 host-owned chrome: the registry card wrappers ALSO serve AlgaDesk mode, where tabs
  render via CustomTabs on a gray page and the white wrappers ARE the surface
  (ClientDetails tabContent memo ~1613). Stripping them needs a host-supplied chrome
  contract (e.g. wrapper injected by FocusViewHost vs CustomTabs, tabs render content
  only) — a designed refactor, not a loop iteration. Same constraint blocks removing the
  duplicated inner titles (Client Tickets h3 / Interactions h2): they're the only titles
  in AlgaDesk mode.
11. 46782b998a voice sweep — offloaded to codex against an adjudicated brief
   (scratchpad voice-sweep-brief.md), 54 files: sentence case, Add [noun], Save,
   ID/money column labels, engine-vocab rewrites, tax help link removed, Notes panels
   retitled, Pagination i18n plurals (itemsLabel_one/_other), hidden-banner tightened,
   equipment pills capitalized, Actions header dropped. Declines recorded in the commit.
   Codex judgment calls accepted: BoardPicker placeholder scoped via prop (shared default
   untouched); billing schedule help was hardcoded in shared/billingClients (no locale).
   Pre-existing failure (clean-tree verified): Documents.drawer.test.tsx —
   Missing "./hooks" specifier in @alga-psa/users.
12. craft batch (codex, craft-batch-brief.md, serialized behind the voice sweep): equipment
   full i18n (defaultValue-only, no locale entries needed for new keys) + typed renders +
   Skeleton loading rows; dashboard recharts dynamic imports typed via bounded casts to
   exported prop types (RadialBarChart uses recharts/types/chart/generateCategoricalChart
   CategoricalChartProps — not publicly exported in recharts 2.15) + typed tooltip + dead
   state removed; both hand-rolled primary-variant save-button classNames -> kit default
   variant (verified renders #8A4DEA, regains dark-mode); Add/Remove -> common.actions.*;
   interactions console.log removed. Full server tsc 0; save button verified live.
REMAINING: 13. gap fills tier 1 (AR strip + balance-due/status on dashboard, warranty on
equipment = ops-depth W4, portal access on contacts) — sequence with ops-depth W1-W5.
