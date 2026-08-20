# Board-level view configuration

**Date:** 2026-08-19
**Branch:** `feature/board-centric-ticketing-ux-tabbed-dedicated-boar`
**Builds on:** `b6a99cd69b feat(tickets): board tab strip makes a board a place you go` (PR #3195)
**UI direction:** C — *board as workspace* (chosen from three mocked options)

## Problem

The board tab strip shipped on this branch made a board reachable. It did not make a
board *look* like itself. Every board is the same generic ticket list with a
single-board filter applied — same columns, same order, same density, same starting
filters, no identity, no state. A board is a place in navigation only.

Three structural problems sit underneath that:

1. **There is no per-board view configuration, and the mechanism that was meant to
   provide one is dead.** The `boards` table carries eleven `display_*` boolean
   columns (`display_contact_name_id`, `display_priority`, `display_severity`,
   `display_urgency`, `display_impact`, `display_category`, `display_subcategory`,
   `display_assigned_to`, `display_status`, `display_due_date`, `display_itil_impact`,
   `display_itil_urgency`). No UI reads any of them; they survive only in
   `board.interface.ts`. Meanwhile every genuinely-used board setting arrived as its
   own migration and its own column — `default_assigned_to`, `sla_policy_id`,
   `manager_user_id`, `enable_live_ticket_timer`, `inbound_reply_reopen_*`,
   `default_assigned_team_id`. The column-per-setting pattern neither scales nor
   survives: it produced a wide table with an abandoned half.

2. **The ticket list has no column controls.** `createTicketColumns` builds straight
   from `TICKET_COLUMNS`, and the only place column visibility can be changed is
   Settings → Display — which is **tenant-wide**. A user who wants to glance at
   "Created By" once must change a setting for everyone. Column *ordering* has no
   authoring surface anywhere; the on-screen order is the catalog's declaration order.

3. **The tab strip shows every active board.** At 25 boards it is a horizontally
   scrolling row. An admin has no way to say which boards deserve permanent tab
   real estate.

## Design decisions

Settled in the design session. These are constraints the implementation must satisfy.

| Decision | Resolution |
| --- | --- |
| **Ownership** | Board view config is **tenant-wide, for all users**. No per-user, per-board persistence and no per-setting lock flags. Users change filters and columns freely while viewing; those changes are interaction state, not stored preference. |
| **Pinning** | `is_pinned` on the board. Only pinned boards get tabs. Unpinned boards stay **fully reachable** via the All-tickets tab and the board filter dropdown; a deep link to an unpinned board renders a transient tab for that visit, reusing today's inactive-board tab behaviour. No overflow menu. |
| **All-tickets tab** | Always the first tab, never removable — the natural home for multi-board filtering. It gets **no board header**. |
| **Storage** | `is_pinned` is a real column (queried, joined, one bit). The view config is a **JSONB document** on `boards`, schema-validated in code — *not* wide columns, *not* a generic key/value table. |
| **Authoring** | **Capture-from-the-list.** The admin arranges the board's view on the real ticket list and saves it. No second filter UI in settings. |
| **Application** | The board's default view applies on **every arrival** at that board tab, unless the URL already carries filter params. |
| **Column controls** | A columns control (visibility + drag-to-reorder) is added to the ticket list, which is what lets capture cover columns. |
| **Surface** | **Board as workspace.** Selecting a board tab reveals a **board header** — identity, ownership, and health — above the list. All view controls collapse into a single `View ▾` menu. |

### Why a JSONB document and not the alternatives

The decisive argument is that **this document already exists one layer up.**
`tenant_settings.ticket_display_settings` holds `list.columnVisibility` today,
resolved through `ticketColumnCatalog.ts`. If the board layer used a different
representation — wide columns, or a generic KV table — the codebase would own two
shapes for one concept plus a translator between them, and whichever settings were
awkward in the second shape would quietly stop being maintained. That is exactly the
history of the `display_*` columns.

- **Wide columns** cannot express column *ordering* without twelve integer columns,
  cannot express "unset, inherit from tenant" without nullable-everything, and are
  the pattern that already failed here.
- **A generic KV table** (`board_settings(tenant, board_id, setting_name, value jsonb)`)
  is not more relational than a document: the values are still opaque JSONB, so it
  buys no integrity, and it costs a pivot on every read. It is a JSONB document with
  extra steps.
- **A relational side table for columns** (`board_list_columns(board_id, column_key,
  visible, position)`) creates rows for something whose universe is a TypeScript const
  array — `column_key` is a foreign key to nothing — and turns "reset to tenant
  default" into a delete-all-rows operation.

The real deliverable is therefore not the column; it is the **missing resolution
layer** the column plugs into.

### Integrity caveat, stated plainly

Captured filters reference `status_id`, `priority_id`, `category_id`, user ids and
team ids. JSONB will not foreign-key-check those. The approach is **validate-on-read**:
ids that no longer resolve are dropped from the applied view. This is the established
pattern on this surface — `resolveInitialBoardTab` already drops a stored board that
no longer exists, and `buildTicketStatusFilterOptions` already drops a `statusId` when
switching to a board that lacks it. Board-owned statuses make board-scoped default
filters *more* coherent than the tenant-level equivalent, not less.

## The board surface

Selecting a board tab reveals a header block between the tab strip and the toolbar:

```
┌──────────────────────────────────────────────────────────────┐
│ All tickets │ ▸Service Desk 24│ Projects 7 │ Technical 0     │
├──────────────────────────────────────────────────────────────┤
│ Service Desk                    24      5        2       7   │
│ Day-to-day inbound support.    OPEN  OVERDUE  BREACH  UNASSG │
│ (MO) Managed by M. Okafor · SLA: Standard Business Hours     │
├──────────────────────────────────────────────────────────────┤
│ Search this board…  Filters 3▾                     View ▾•   │
├──────────────────────────────────────────────────────────────┤
│ TITLE            STATUS      PRIORITY  CLIENT      DUE ↑      │
```

- **Identity** — board name and description.
- **Ownership** — `manager_user_id` avatar and name, and the board's SLA policy name.
- **Health** — open · overdue · SLA breach · unassigned, as four counts.
- **`View ▾`** — one menu holding Columns (visibility + drag-to-reorder), the density
  slider, **Save as this board's default view**, and **Reset to tenant default**. The
  save and reset items are gated on `ticket_settings:update`. A dot on the control
  marks "the current view differs from what is saved."

The header **degrades gracefully**: no description, no manager, or no SLA policy each
simply omit their line rather than rendering an empty slot. The **All-tickets tab shows
no header** — it has no identity to state.

The header is not optional and carries no toggle. A per-board "show the header" flag
would add a settings control, a document key, a resolution path and a test axis to save
90px on boards an admin could simply unpin — and the whole point of pinning is that the
tab strip already expresses which boards are worth space.

### Why C, and what it costs

C is the only option of the three that makes the board's identity — not just its filter
— visible, and it is the answer that actually delivers the branch's own premise. It also
gives the dead `display_*` concept a live successor rather than a sibling.

Its costed risk was a new stats pipeline. That turned out not to exist: **overdue, SLA
breach and unassigned are all derivable from columns already on `tickets`**
(`due_date`, `sla_policy_id`, `sla_response_due_at`, `sla_resolution_due_at`,
`sla_response_met`, `sla_resolution_met`, `sla_paused_at`, `assigned_to`) — the same
derivations `optimizedTicketActions.ts:1340` already uses for `slaStatusFilter`. They
become three additional `COUNT(*) FILTER (…)` aggregates on the **existing** tickets
`GROUP BY` in `getBoardListStats`. No new query, no new round trip.

The remaining real cost is ~90px of vertical space above every board list. Pinning is
the release valve: a board nobody curates is a board nobody should have pinned.

## The shared layer

The centre of this work is a single resolver that layers three inputs and is consumed
identically by the tenant settings screen, the board settings section, and the dashboard.

```
resolveTicketViewSettings({ board, tenant })
    boards.list_view_settings   →   tenant_settings.ticket_display_settings.list   →   TICKET_COLUMNS catalog
```

New module: `packages/tickets/src/lib/ticketViewSettings.ts` (plain data, no JSX, not
`"use server"` — importable from components, server actions, and the column builder
alike, matching `ticketColumnCatalog.ts`).

```ts
export interface TicketViewSettings {
  columnVisibility?: Partial<Record<TicketListColumnKey, boolean>>;
  columnOrder?: TicketListColumnKey[];       // sparse; unlisted keys keep catalog order, appended
  tagsInlineUnderTitle?: boolean;
  densityLevel?: number;                     // 0..100, step 10 (matches the existing slider)
  filters?: Partial<ITicketListFilters>;     // capture-excluded keys stripped before persist
}
```

Deliberate shape choices:

- **`TicketingDisplaySettings.list` becomes `TicketViewSettings`.** The two existing
  keys (`columnVisibility`, `tagsInlineUnderTitle`) already sit at exactly that path,
  so no tenant JSON migration is needed — the type widens, stored data does not move.
  `boards.list_view_settings` stores the same document *directly* (not nested under
  `list`), because a board has no other display settings to nest beside it.
- **Sort lives inside `filters` as `sortBy`/`sortDirection`.** `ITicketListFilters`
  already carries both; a separate `sort` key would be a second representation of
  something the filter type already models.
- **Merging is group-level, not per-key.** If a board defines `columnVisibility`, it
  replaces the tenant's map entirely rather than deep-merging. Capture always writes a
  complete map, so per-key merge would only create ambiguity with no expressive gain.
- **Reset to tenant default is `list_view_settings = NULL`**, not an empty object.

New catalog helper alongside `resolveTicketColumnVisibility`:

```ts
resolveTicketColumnOrder(stored?: string[]): TicketListColumnKey[]
```

Stored keys first, in stored order, filtered to keys the catalog still knows; then
every remaining catalog key in catalog order. A column added to `TICKET_COLUMNS` after
a board's view was saved therefore still appears — it does not vanish because it was
absent from a stored order array.

## Capture semantics

`captureTicketViewSettings(currentView) → TicketViewSettings` (pure, in
`ticketViewSettings.ts`, unit-testable without mounting the dashboard).

**Excluded from capture** — the exclusion list is a single exported constant so it
cannot drift:

- `boardId`, `boardIds`, `excludeBoardIds` — the board scope *is* the tab. Capturing it
  would let a board's default view scope it to a different board.
- `boardFilterState` — board-scope machinery, same reason.
- `searchQuery` — transient; a stray search string must not stick permanently.

**Included:** every other `ITicketListFilters` key (status, priority, categories,
client, contact, tags, assignment including the caller-relative `assignedToMe`, the
due-date family, `responseState`, `slaStatusFilter`, `showOpenOnly`, `bundleView`,
`sortBy`/`sortDirection`), plus `columnVisibility`, `columnOrder`, `densityLevel`.

Because capture reads the live view rather than a parallel form, **every filter added
to `ITicketListFilters` in future is defaultable for free** — there is no second UI
that must be taught about it.

### Where the save action lives

**`View ▾` → "Save as this board's default view"**, gated on `ticket_settings:update`
(the permission that already guards board and priority settings). Its destination
depends on the active tab:

- **A board tab** → writes `boards.list_view_settings` for that board.
- **The All-tickets tab** → writes `tenant_settings.ticket_display_settings.list`,
  i.e. the layer that already backs the tenant Display Settings screen. Same affordance,
  correct altitude, no new mechanism.

## Application semantics

The board's default view applies **on every arrival at a board tab**, unless the URL
already carries filter params.

This is the only rule under which a configured default actually means something, and
it costs no new state. Because board-tab moves already **push** history (shipped on
this branch), a user who tweaks filters and tabs away gets their tweaked state back
via browser Back — the tweaks are not lost, they are simply not what a fresh tab click
produces. The board reliably looks like itself when you go there.

Precedence, in order:

1. URL filter params (a shared link) — always win.
2. The board's `list_view_settings`.
3. Tenant `ticket_display_settings.list`.
4. Catalog defaults.

Application reuses the existing merge path in `TicketingDashboardContainer` so a tab
click still produces **exactly one** `fetchTicketsWithPagination` call — the smoke test
on this branch verified one server action per navigation and that property must hold.

`localStorage['ticket_list_density_level']` **stops being written and stops being read.**
Left in place it would silently outrank every board's configured density forever, for
every user who has ever touched the slider. Density becomes: board → tenant → default 50.

## Scope of application

Board-level view settings apply to the **MSP ticket list only**. `getTicketingDisplaySettings`
is also consumed by `packages/client-portal/src/components/tickets/TicketList.tsx`,
`TicketDetails.tsx`, `MspClientTickets.tsx` and `MspContactTickets.tsx`. Those surfaces
have no board tabs and continue to resolve **tenant-only**. The resolver's `board`
input is simply absent there, which the layering already expresses — no branching
required at the call sites.

## Implementation

### 1. Migration

`server/migrations/<ts>_add_board_pinning_and_list_view_settings.cjs`

```js
alterTable('boards', t => {
  t.boolean('is_pinned').notNullable().defaultTo(false);
  t.jsonb('list_view_settings').nullable();
});
// Backfill: every currently-active board is pinned, so the strip looks exactly as it
// does today on upgrade and admins curate DOWN from there.
update('boards').where({ is_inactive: false }).set({ is_pinned: true });
```

Add an index on `(tenant, is_pinned)` only if the board list query proves it necessary —
board counts per tenant are small and `getAllBoards` already reads the whole set.

Down migration drops both columns.

### 2. Types and schema

- `packages/types/src/interfaces/board.interface.ts` — add `is_pinned?: boolean` and
  `list_view_settings?: TicketViewSettings | null`. Add a comment above the `display_*`
  block recording that those columns are unread and superseded by `list_view_settings`,
  so the next reader does not mistake them for live configuration.
- `server/src/interfaces/board.interface.tsx` — mirror it. Both copies exist and must
  not drift.
- Zod validation for `list_view_settings` on write, colocated with the board actions'
  existing `CreateBoardInput`/`UpdateBoardInput` types. Unknown keys are rejected on
  write, not silently stored.

### 3. Shared layer

- **New** `packages/tickets/src/lib/ticketViewSettings.ts` — `TicketViewSettings`,
  `resolveTicketViewSettings`, `captureTicketViewSettings`, `CAPTURE_EXCLUDED_FILTER_KEYS`.
- `packages/tickets/src/lib/ticketColumnCatalog.ts` — add `resolveTicketColumnOrder`.
- `packages/tickets/src/actions/ticketDisplaySettings.ts` — widen `TicketListSettings`
  to `TicketViewSettings`; leave the existing dedicated-column-then-nested-settings read
  fallback untouched.
- Export both from `packages/tickets/src/lib` (the barrel `@alga-psa/tickets/lib` already
  serves `TOGGLEABLE_TICKET_COLUMNS` to the settings screen).

### 4. Server actions

**`getBoardListStats`** (`boardActions.ts:194`) — extend the existing tickets `GROUP BY`
with three aggregates for the header, alongside the current `total`/`open`:

```sql
COUNT(*) FILTER (WHERE s.is_closed IS NOT TRUE AND t.due_date < now())            AS overdue
COUNT(*) FILTER (WHERE s.is_closed IS NOT TRUE AND t.assigned_to IS NULL)         AS unassigned
COUNT(*) FILTER (WHERE s.is_closed IS NOT TRUE AND <breached>)                    AS sla_breached
```

`<breached>` reuses the exact predicate `optimizedTicketActions.ts` applies for
`slaStatusFilter: 'breached'` — extract it to a shared SQL fragment rather than
re-deriving it, so the header count and the filter can never disagree about what
"breached" means. Also return `is_pinned` so the tab strip gets pinning and counts in
one round trip.

While here, fix the pill inconsistency the previous smoke pass found: `ensure()` also
runs for the statuses and close-rule `GROUP BY`s, so a board with zero tickets but
non-zero statuses gets an entry and renders a `0` pill, while a board with zero of both
gets no entry and no pill. Two boards with identical zero open tickets render
differently. Make it uniform — a pinned board always gets a count, including `0`.

**`getAllBoards` / `findBoardById` / `updateBoard`** — carry `is_pinned` and
`list_view_settings` through.

**New** `saveBoardDefaultView(boardId, TicketViewSettings)` and
`clearBoardDefaultView(boardId)` in `boardActions.ts`, both gated on
`ticket_settings:update` via the existing `hasPermission` + `permissionError` pattern.

### 5. Board header

New component `packages/tickets/src/components/BoardHeader.tsx`, rendered by
`TicketingDashboard` only when a single real board is selected — reuse
`resolveActiveBoardId` from `boardTabs.ts` rather than deriving board-selection state a
second time.

- Props: the `IBoard`, its `BoardListStats`, and the resolved manager/SLA display names.
- Renders name, description, manager avatar + name, SLA policy name, and the four counts.
- Each optional element is omitted entirely when its source is null.
- Rendered on every board tab; never on the All-tickets tab.
- Counts are decoration: they load out of band exactly as the tab pills do today and
  the header renders without them until (or unless) stats arrive.

### 6. `View ▾` menu and column controls

One menu in the ticket list toolbar, replacing the standalone density slider:

- **Columns** — checkbox list over `TOGGLEABLE_TICKET_COLUMNS` (labels already carry
  `titleKey` + `titleFallback`) plus drag-to-reorder over the order resolved by
  `resolveTicketColumnOrder`.
- **Density** — the existing 0–100 slider, moved in.
- **Save as this board's default view** / **Reset to tenant default** — permission-gated.
- A dot on the control when the live view differs from the resolved saved view.

All of it is interaction state with no persistence of its own: it seeds from the
resolved view and is what capture reads. `createTicketColumns` gains a `columnOrder`
option and orders its output by it; the `fixed`/`folded`/`tags` column kinds keep their
existing special handling and are not reorderable.

### 7. Tab strip: pinning

`packages/tickets/src/lib/boardTabs.ts` — `buildBoardTabs` filters to
`board.is_pinned === true`, keeping the existing escape hatch that the *active* board is
always included even when it would otherwise be excluded. That one clause already
handles the inactive-board case and now handles the unpinned-deep-link case with no new
branch: a deep link to an unpinned board renders its transient tab, which disappears
when you leave. Ordering stays `display_order` then name.

`hasBoardFilterParam` / `BOARD_FILTER_URL_PARAMS` are unchanged — no new URL params, so
the RSC parser in `server/src/app/msp/tickets/page.tsx` needs no parity update.

Zero pinned boards is a legitimate state (an admin unpinned everything): the strip
renders All-tickets alone rather than hiding, so the screen never loses its navigation.

### 8. Board editor: "Appearance & defaults"

New `EditorAccordionSection` in `BoardsSettings.tsx`, placed after General and following
the six existing sections (General · Assignment & SLA · Email & inbound replies · Close
rules · Automation · Priorities & statuses · Display & behaviour):

- **Pin to the tickets screen** toggle — with the help text that pinned boards get a
  permanent tab and unpinned boards stay reachable from All tickets and the board filter.
- **Preview** — a static miniature of the header plus a few list rows, rendered from the
  resolved view. It reuses `BoardHeader` at a reduced scale rather than re-implementing
  the layout; the rows are placeholder bars, not live tickets, because this is a shape
  preview and fetching a board's tickets inside a settings accordion is not worth the
  round trip.
- **Saved view** summary — one line, e.g. *"Open only · Priority: High · sorted by Due
  date ↑ · 6 columns · density 40"*, or an explicit "Inherits tenant defaults" when
  `list_view_settings` is `NULL`.
- **Open this board** (jumps to the tab) and **Reset to tenant default**.
- A note stating that the view is arranged on the board itself and saved from `View ▾`.

The section deliberately contains no filter controls. The weight of this work belongs in
the shared resolver, not in a settings form duplicating the ticket list's filter surface.

Since `is_pinned` now lives here rather than in General, General keeps `is_default` and
`display_order` — `display_order` already doubles as tab order and its existing help text
should say so.

### 9. i18n

New keys under `ticketing.boards.*` and `dashboard.*` in
`server/public/locales/en/features/tickets.json`, with parity added to `de`, `es`, `fr`,
`it`, `nl`, `pl`, `pt` — matching what `573d29dc69` did for `dashboard.boardTabs.all`.
The repo has locale-parity tests (`templateLocaleParity.test.ts`,
`menuConfig.i18n.test.ts` precedent) and the tickets-namespace i18n tests must pass.

## Testing

**Unit (pure, no mount)** — where the bulk of coverage belongs, matching how
`boardTabs.ts` was tested:

- `resolveTicketViewSettings`: board wins over tenant wins over catalog; group-level
  replacement, not deep merge; `NULL` board settings falls through cleanly.
- `resolveTicketColumnOrder`: stored order honoured; unknown stored keys dropped; a
  catalog key absent from stored order still appears, appended in catalog order.
- `captureTicketViewSettings`: every key in `CAPTURE_EXCLUDED_FILTER_KEYS` is stripped;
  everything else survives a round trip.
- Validate-on-read: a captured `statusId` that no longer exists on the board is dropped
  and does not produce an empty list.
- `buildBoardTabs`: unpinned boards absent; active-but-unpinned board still rendered;
  zero pinned boards yields All-tickets alone.
- The shared breached-SLA predicate produces the same set as `slaStatusFilter: 'breached'`.

**Component:**

- `BoardHeader` omits description / manager / SLA lines when their sources are null;
  renders nothing for the All-tickets tab; renders without counts before stats arrive.
- Columns control toggles visibility and reorders; `createTicketColumns` respects
  `columnOrder`; fixed/folded/tags kinds unaffected.
- Save and Reset items hidden without `ticket_settings:update`.

**Migration:** backfill pins exactly the active boards and leaves inactive ones
unpinned; down migration drops both columns.

**Live smoke on the dev stack (:3281)** — the properties the previous smoke pass
established must not regress:

- Exactly one `fetchTicketsWithPagination` per tab click and per back/forward step.
- Header counts match direct DB queries for open, overdue, breach and unassigned.
- Pills match DB open counts; a pinned board with zero tickets shows `0` (the fix above).
- Board-scoped statuses still reconcile when switching to a board lacking the selected
  status.
- Deep link to an unpinned board renders a transient tab; leaving removes it.
- Saving a default view on a board, navigating away and back, reproduces the saved view;
  a deep link with filter params still overrides it.
- Density no longer sticks from `localStorage` across boards.
- Header degrades on a board with no description, no manager and no SLA policy.

## Out of scope

- Per-user or per-user-per-board view persistence, and per-setting lock flags —
  explicitly decided against.
- A saved-views / `board_views` table, multiple named views per board, view sharing.
- An overflow "More boards" menu on the tab strip.
- Per-board kanban or swimlane layouts, board-scoped bulk actions, board-scoped create.
  The header is the seam where a view-type switcher would later land.
- Migrating or removing the dead `display_*` columns. They are documented as superseded
  here; removing them is its own change with its own risk.
- Applying board-level settings to client-portal or client/contact ticket surfaces.

## Notes for the implementer

- The ticketing UI lives in `packages/tickets/src`, **not** `server/src/components/tickets`.
  Both `board.interface` copies (`packages/types` and `server/src/interfaces`) must be
  updated together.
- `updateURLWithFilters` takes a 4th `historyMode` argument (`'replace' | 'push'`);
  board-tab moves push, every other filter edit replaces. `syncFromUrl` clears
  `filterFetchTimeoutRef` before applying — without it a filter edit still inside the
  300ms debounce fires after a popstate and refetches state the user just navigated away
  from. Applying a board default view must not reintroduce that race.
- Restoring the last-active board tab (`tickets_last_active_board`) applies at most once
  per mount, after `useUserPreference`'s `isLoading` clears, and a URL naming a board
  always wins (`TicketingDashboardContainer.tsx:551`). Default-view application layers on
  top of that decision — it must not become a second independent effect firing its own
  fetch.
- The three mocked UI directions considered before landing on C are preserved at
  `/tmp/board-surface-options.html` (not committed).
