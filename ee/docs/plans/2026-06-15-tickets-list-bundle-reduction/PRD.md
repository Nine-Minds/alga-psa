# PRD — Tickets List Load-Time Reduction (bundle/hydration)

**Status:** Draft for review
**Owner:** TBD
**Created:** 2026-06-15
**Plan slug:** 2026-06-15-tickets-list-bundle-reduction

---

## 1. Problem statement & user value

The MSP ticketing dashboard (`/msp/tickets`) is slow to become usable. A production
performance trace (algapsa.com, warm cache) shows:

- **LCP 3,048 ms**, of which **2,774 ms (91%) is render delay** — the browser receives
  HTML quickly (TTFB 274 ms) but can't paint until it finishes executing the route's JS.
- **~9.3 MB of decoded JavaScript across 103 chunks** hydrating on the list route.
- Backend is **not** the bottleneck: server actions return in ~24–27 ms.
- The list route eagerly bundles heavy client code that is **not on screen at first paint**:
  - 7 dialogs imported only by the list (`BulkAssign/Tags/DueDate/Status/Priority`, `TicketImportDialog`, `TicketExportDialog`).
  - The full `ClientDetails` component (2,215 lines + all client tabs) for the side-drawer quick view, even though the drawer only ever shows the first ("details") tab.
- Each list view also fires **48 redundant RSC prefetch requests** (two `<Link>`s per
  row × ~24 rows) that force the server to render ticket detail pages nobody asked for.

**User value:** the tickets list paints and becomes interactive noticeably faster, and the
server stops doing wasted detail-page renders on every list view.

## 2. Goals

- **G1 (primary):** Reduce tickets-list initial JavaScript / hydration cost and improve
  LCP / render delay, measured by build output (list route first-load JS) and a repeat
  production-style performance trace.
- **G2:** Remove the redundant per-row RSC prefetch traffic from the list.
- **G3:** Replace the full-weight client drawer with a genuinely lightweight
  `ClientQuickView`, and reuse it at **every** client quick-view call site.
- **G4:** Move the 7 list-only dialogs out of the list route bundle via route-level
  code splitting (static imports only).

## 3. Non-goals

- **No `next/dynamic` / `React.lazy` / `import()` code-splitting.** Architectural
  decision: the team avoids dynamic imports to keep module boundaries clean.
- **No changes to `QuickAddTicket` or its rich-text editor.** It is shared across 9
  surfaces (including the global header quick-create), so list-only extraction yields
  little app-wide benefit. Tracked as a possible separate future plan.
- **No change to `QuickAddCategory`** — shared by 4 components, not cleanly list-only.
- App-shell server-action burst (~20 POSTs during hydration) and the 15 s job-metrics
  poll (`Header.tsx`) — real but shell-level; out of scope here.
- Deep-linkable / refresh-safe dialog URLs are **not a goal** (acceptable side effect of
  intercepting routes, but we will not invest extra to guarantee it).

## 4. Hard constraints

- **C1 — No visual change for end users.** Dialogs must still appear as modal overlays on
  top of the list (not full-page navigations). The client drawer must look identical.
- **C2 — Dialogs must respect all current list filters** (and, for bulk actions, the
  current row selection), exactly as today.
- **C3 — No dynamic imports** (see non-goals).
- **C4 — Multi-tenant safety unchanged.** This is primarily a UI/bundling refactor; any
  server actions reused by new routes keep their existing `tenant` scoping.

> **Routing decision (derived from C1 + C2 + C3):** Plain separate full pages are ruled
> out (they change the UX from modal → full navigation, violating C1). Keeping the dialogs
> inside the list component keeps them in the list bundle (fails G1/G4). With dynamic
> imports off the table (C3), the only approach that satisfies all three is **Next.js
> intercepting routes + a parallel `@modal` slot**: each dialog lives in its own route
> segment (so it's a separate, statically-imported route bundle) but renders as a modal
> overlay over the still-mounted list. This pattern does not exist in the codebase yet.

## 5. Affected users / flows

- MSP internal users on the tickets list: open Quick View on a client, run bulk actions on
  selected tickets, import/export tickets. All flows must look and behave the same.
- Any user hitting the other client quick-view surfaces (clients list, billing dashboard,
  ticket detail drawer, projects, interactions, user list) — they get the new lighter
  component with identical appearance.

## 6. Approach (workstreams)

### A. Row-link prefetch fix (smallest, immediate)
- Add `prefetch={false}` to the two `<Link>`s in
  `packages/tickets/src/lib/ticket-columns.tsx` (ticket-number col ~line 219, title col
  ~line 273). Clicks are already intercepted (`e.preventDefault()` → `onTicketClick`), and
  middle-click / open-in-new-tab keep working via the retained `href`.

### B. Lightweight `ClientQuickView` + reuse everywhere
- Rebuild `packages/clients/src/components/clients/ClientQuickView.tsx` so it imports only
  the "details" tab content (what `ClientDetails` renders when `quickView` →
  `tabContent[0]`), **not** the full `ClientDetails` module (which statically imports
  contacts list, billing config, interactions feed, notes panel, and 3 Hudu tabs).
- Extract the shared details-tab content into a small component so both `ClientDetails`
  (full page) and `ClientQuickView` can use it without `ClientQuickView` dragging in the
  other tabs.
- Wire **all** client quick-view call sites to `ClientQuickView`:
  - `packages/msp-composition/src/tickets/MspTicketsPageClient.tsx:18`
  - `packages/msp-composition/src/tickets/MspTicketDetailsContainerClient.tsx:71`
  - `packages/msp-composition/src/clients/MspClientDrawerProvider.tsx:36`
  - `packages/msp-composition/src/billing/MspBillingDashboardClient.tsx:18`
  - `packages/msp-composition/src/projects/MspClientIntegrationProvider.tsx:44`
  - `packages/clients/src/components/clients/Clients.tsx:1779`
  - `packages/clients/src/components/interactions/InteractionDetails.tsx:209`
  - `packages/projects/src/components/Projects.tsx` (renderClientDetails, ~1024)
  - `server/src/components/settings/general/UserList.tsx:206`
  - (verify contact-context `<ClientDetails>` usages: `Contacts.tsx:697`,
    `MspContactTickets.tsx:230` — classify as client quick view or leave)

### C. Route-extract the 7 list-only dialogs (intercepting + parallel routes)
- Add `server/src/app/msp/tickets/layout.tsx` hosting `{children}` + a `@modal` parallel
  slot, and `server/src/app/msp/tickets/@modal/default.tsx` returning `null`.
- Create route segments for each dialog under `msp/tickets/...` with an intercepting
  `(.)` variant in `@modal` that renders the dialog as an overlay, plus a plain segment
  for the hard-load fallback.
- Triggers on the list become navigations (`router.push` / `<Link>`) to those routes
  instead of toggling local `isOpen` state; the dialog components move into the route
  segments so they leave the list route's module graph.
- **Shared state:** introduce a tickets-segment client context provider (in
  `tickets/layout.tsx`) holding the current **filters** and **selected ticket ids**, so the
  intercepting modal routes (sibling subtrees that cannot read the list page's local state)
  can honor C2. The list writes to it; dialog routes read from it. Filters are already
  partly URL-synced (`TicketingDashboard.tsx:510,625`) and can be read from `searchParams`
  as a backstop.
- Dialog order by effort/benefit: **Import → Export** (no selection dependency, easiest,
  likely heaviest) first; then the **5 bulk dialogs** (require the selection context).

## 7. Data model / API notes

No schema changes. Existing server actions (bulk assign/tags/due-date/status/priority,
import, export, client fetch) are reused unchanged and keep their `tenant` scoping.
Export/bulk-select-all must continue to pass the current `ITicketListFilters` to the
server action so results respect filters (C2).

## 8. Risks & mitigations

- **R1 — Intercepting/parallel routes are a new pattern here.** Risk of focus/scroll/
  back-button regressions and SSR quirks. *Mitigation:* prototype one dialog (Import)
  end-to-end first; add a `default.tsx`; manual + e2e checks for open/close/refresh/back.
- **R2 — Selection-state lifting is the highest-effort item.** Selection lives deep in
  `TicketingDashboard` (`selectedTicketIds`, line 252). *Mitigation:* lift to a small
  tickets-scoped context; if a bulk dialog's effort:benefit is poor, it may stay in-list
  (re-evaluate during A/B; user scoped "all" but ROI matters).
- **R3 — Filter fidelity (C2).** Modal routes must see the exact active filters.
  *Mitigation:* shared context is source of truth; e2e assert each dialog acts on filtered
  set.
- **R4 — `ClientQuickView` is reused at ~10 sites.** Rebuilding it risks regressions
  across clients/billing/projects/tickets. *Mitigation:* keep visual output identical to
  current `quickView` details tab; verify each call site.
- **R5 — "No visual change" (C1).** Modal-from-route must match current modal styling/
  behavior. *Mitigation:* reuse the existing `Dialog` components inside the route segments.

## 9. Success metrics / Definition of Done

- **DoD-1:** Production-style repeat trace of `/msp/tickets` shows reduced render delay and
  LCP vs. the 2,774 ms / 3,048 ms baseline (record exact numbers in SCRATCHPAD).
- **DoD-2:** `next build` shows the tickets-list route **first-load JS reduced**; the 7
  dialogs and full `ClientDetails` no longer appear in the list route chunk graph.
- **DoD-3:** Loading the list fires **0** per-row RSC prefetch requests; clicking a ticket
  still opens it; middle-click/open-in-new-tab still work.
- **DoD-4:** Every client quick-view surface renders the lightweight `ClientQuickView` and
  looks identical to today.
- **DoD-5:** Each dialog opens as a modal overlay (no full-page nav), respects current
  filters/selection, and performs its action correctly. No visual change reported.
- **DoD-6:** No `next/dynamic` / `React.lazy` introduced.

## 10. Open questions

- OQ1: Confirm the intercepting-routes approach is acceptable as a new pattern (it's the
  only option satisfying C1+C2+C3). If not, we must relax C1 (allow full pages) or C3.
- OQ2: Is there an existing client-side store pattern (zustand/jotai/context) preferred for
  the tickets selection/filter context, or should we add a plain React context?
- OQ3: For bulk dialogs with poor effort:benefit, is leaving them in-list acceptable, or is
  full extraction of all 7 required?
- OQ4: Should `Contacts.tsx:697` / `MspContactTickets.tsx:230` `<ClientDetails>` usages be
  migrated to `ClientQuickView` too, or are they intentionally full?
