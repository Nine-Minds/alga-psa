# Client Command Center (Candidate C)

## Problem

The client detail screen has grown to 12+ flat tabs (14 with EE Hudu tabs) that overflow the
viewport and bury status behind navigation. An MSP operator opening a client cannot answer
"how is this client doing?" without visiting several tabs. The tab row also cannot absorb new
modules (each inventory feature added another tab).

## Vision

Replace the tab layout on the **full-page client screen** with a live dashboard ("command
center"): a header with identity + actions, an **attention strip** of cross-module exceptions,
a **bento grid** of live cards (one per domain), and a **unified timeline** merging events from
every module. Deep work happens in **focus views** — full-height slide-overs that host the
existing tab components unchanged.

Mockup of record: `/tmp/client-redesign-c-command-center.html` (approved 2026-07-02).

## Goals

- Glanceable client health: KPIs and exceptions visible without navigation.
- Every number rendered is a live query — **no static/placeholder data anywhere**.
- All 12+ existing tab surfaces remain reachable (focus views), with `?tab=` deep links intact.
- Tab-bar scaling problem eliminated permanently (new modules = new card or timeline source).

## Non-Goals

- No persisted activity/event store (timeline is a read-time UNION; revisit only if perf demands).
- No customizable/user-configurable card layout.
- No real-time push updates (data loads on page view; refresh via reload).
- No portal/client-facing changes; no AlgaDesk mode changes.
- No precise MRR computation (see D7).
- No new notification types.

## Users & Primary Flows

MSP dispatchers/account managers/owners. Flows: (1) open client → scan attention strip and
cards → jump into the one thing that needs action; (2) follow a deep link (`?tab=equipment`)
from search/SO screens → land on command center with that focus view open; (3) review the
timeline to reconstruct recent history across modules.

## Decisions

- **D1 — Direct replacement, no feature flag.** The command center is the client screen for the
  full-page route. `quickView`/`isInDrawer` renders keep the existing compact tab layout
  (nested-drawer UX and AlgaDesk are out of scope).
- **D2 — Focus views reuse the existing tab registry.** `ClientDetails.baseTabContent` already
  is `{id, label, content}[]`; the command center consumes the same array and hosts entries in
  a `Drawer` (width ~90vw). No module screens are rewritten.
- **D3 — Deep-link compat.** `?tab=X` opens focus view X on load; opening/closing a focus view
  updates the URL (`router.replace`) so links stay shareable. Unknown tab ids are ignored.
- **D4 — Data actions live in `packages/clients`** (`clientPulseActions.ts`,
  `clientTimelineActions.ts`) using direct knex reads against other modules' tables (established
  idiom, avoids package import cycles).
- **D5 — RBAC-shaped payload.** Base gate `client:read`. Sections are included only when the
  user holds the matching permission: service → `ticket:read`; money → `billing:read`;
  install base + SO/RMA/equipment events → `inventory:read` (managed-asset count → `asset:read`);
  documents → `document:read`. UI renders only the cards present in the payload. Timeline
  events filter by the same map.
- **D6 — Honesty rules (the contract with the user):**
  - Aging bars show **outstanding = total − recorded payments − credit applied**, bucketed by
    `due_date`, finalized invoices only; card is labeled "recorded payments deducted".
  - "Client waiting" attention flag derives only from `comments.author_type = 'client'`; if no
    client-authored comments exist, the flag simply never appears.
  - Notes are a collaborative document, not discrete events → **no note events** in the timeline.
  - Every card hides (or shows an explicit zero/empty state) rather than showing placeholders.
- **D7 — No forced MRR.** `contracts` pricing spans fixed/hourly/usage config tables; a single
  "MRR" number would be an estimate. The money card shows active contract count instead.
  CSAT comes from the already-loaded `surveySummary` (not duplicated in pulse).
- **D8 — Attention strip flags (v1):** draft invoices (aggregate + newest ref), partially
  fulfilled sales orders, overdue open tickets (`due_date < now`), client-waiting tickets (D6),
  open RMAs. Severity fixed per kind; strip renders nothing when there are no flags.
- **D9 — Timeline sources (v1):** tickets opened/closed, invoices created/finalized, ticket
  materials added, stock units delivered, interactions, quote activities (incl. converted-to-SO),
  RMAs opened/closed, sales orders created. Cursor pagination `(occurred_at, id)` descending,
  read-time UNION with per-source limits.

## Data Model / API

No migrations. Two new server actions (contracts in
`packages/clients/src/lib/commandCenterTypes.ts`):

- `getClientPulse(clientId) → ClientPulse` — permissions map, per-card summaries
  (service, money, installBase, people, locations, documents, record), attention flags.
- `listClientTimeline(clientId, { cursor?, types?, limit? }) → ClientTimelinePage`.

## Acceptance Criteria

1. Full-page client screen renders header, attention strip, cards, timeline — all values live.
2. Every legacy tab is reachable as a focus view; `?tab=` deep links open the right one;
   in-app links into client subtabs (e.g. Equipment) still work.
3. A user missing `billing:read` sees no money card, no money flags, no money timeline events.
4. Aging buckets are correct against seeded invoices/payments/credits (DB-backed test).
5. Timeline merges ≥4 source types in correct descending order with working pagination (test).
6. quickView drawer rendering of ClientDetails is unchanged.
7. Server tsc clean; inventory/billing/clients suites green; browser smoke on Emerald City passes.

## Risks

- ClientDetails is 1861 lines with tangled state; restructure must not break quickView. Mitigation: additive — command center is a sibling render path consuming the same registry.
- Focus-view components may assume full-page width. Mitigation: 90vw drawer + per-tab smoke.
- Pulse fan-out (~10 queries) on every client open. Mitigation: single action, parallel queries, all on indexed tenant+client columns.
