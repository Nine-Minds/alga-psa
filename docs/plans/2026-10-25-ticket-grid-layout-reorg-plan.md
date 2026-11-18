# Ticket screen (Grid layout) reorganization

Status: design of record, and **implemented on this branch**. The design was built and iterated live in the Design Session; this document records what was built and why. The next board step is Smoke Test, with "Manual smoke" below as the script.

PSA ticket: alga-2026-0002838. Branch: `feature/ticket-screen-move-receive-equipment-out-of-the`.

## Problem

The ticket detail screen's Grid (bento) layout had grown by accretion. Each new feature dropped its button into whatever row had room: Receive equipment, Quick invoice, Create Task, Link to Task, Print work tag, Duplicate and Delete were spread across the page header and the hero card. Other problems:

- The header row was cramped, and the live-updates notice overlapped the badges.
- Breakpoints keyed off the viewport, so with the app sidebar open the three columns were squeezed at 1280px. Below 1280 the right rail fell under a very long timeline.
- About 16 side tiles had equal weight, and the empty ones each took a full card.

## How the design was reached

The design came from an adversarial loop. Each round, a fresh judge subagent with no knowledge of the intended fixes scored captures of a real ticket at 1600, 1280 and 1024px (first screen plus full page) for layout and organization on a 1–5 scale. Fixes were spiked in this worktree between rounds.

Scores by round: 2.5 → 2.75 → 3.25 → 3.25 → 3.25 → 3.4 → 3.4 → 3.5. The user then made two final fixes and locked the design.

The spike was then finished in place rather than handed to Draft Implementation:

- i18n keys for all ten locales, with the pseudo-locales regenerated
- the existing tests updated to the new contracts
- new tests for each mechanism
- a cleanup pass

The code on the branch is the implementation; this document is its contract.

## Target layout

**Page header row (sticky):**

- left: `← Tickets` (quiet ghost link), the prev/next pager with position
- right: the live-status dot (icon-only, the full text as a tooltip) and a quiet small Grid/Entry toggle

In Grid mode the header row shows no ticket number, origin badge or reply-state badge; they live in the hero. Entry mode keeps its current header contents, with the actions consolidated into the ⋯ menu (below).

**Hero card:**

- **Title row.** The title is prefixed with a muted `#TICKET-NUMBER`, wraps rather than truncating, and has a flex-basis of about 28rem. The action cluster sits right-aligned in the same row and wraps to its own row when the title would otherwise drop below that basis. Cluster contents, in order:
  - escalation chip
  - Resolution SLA slab (only when a policy applies)
  - stopwatch chip
  - **Resolve and close** (the only filled primary on the screen)
  - **All fields** (outline)
  - **⋯** menu: Print work tag, Duplicate, Create template, Create workflow, a separator, then Delete in red
- **Metadata line** (full width under the title row; flex with gaps and no `·` separators, so wrapping never leaves an orphan separator):
  - Opened by X (via source)
  - customer as "Contact · Client"
  - origin badge
  - "Created ‹relative›" and "Updated ‹relative› · ‹user›", each with the absolute time as a tooltip
  - tags (tag icon plus TagManager inline)
  - the My group control, when present, on the same row
- **Fields.** A container-queried grid. At hero widths of 720px and up it is 4 columns: Status, Assigned to, Priority, Reply status, then Due, Board, Category (Category spans 2). Below 720px it is 2 columns showing only the four triage fields; Due, Board and Category stay reachable through All fields.
  - The assignee field drops the inline calendar icon and the `+N` additional-agents popover; additional agents belong to the Team tile.
  - All fields use the same border token and height (see the shared-component changes).
- **Description.** Its own row. When empty, a full-width dashed prompt: "Add a description — what is the problem, and what does the customer need?". Clicking it opens the editor. Fix the empty detection (below).
- The save bar and the unsaved/conflict alerts are unchanged.

**Board (below the hero):** placed by the new `BentoBoard` engine (see Mechanisms). Tiles, in groups and rank order:

| Group (label) | Tiles (rank order) | Wide-tier column |
|---|---|---|
| Customer | Contact | start |
| Work | SLA clocks (only when a policy applies), Time & billing, Checklist, Project tasks, Scheduled work, Appointment requests | end |
| People | Team, Watch list, Customer feedback | start |
| Linked items | Assets (+ Receive equipment), Documents, Materials, Calls and emails, Passwords, External links | start |

Tiers are measured on the board's own width, not the viewport:

- **wide** (≥ 1440px): Customer + People + Linked items | timeline | Work
- **medium** (≥ 760px): timeline | one rail in group order, with section labels
- **narrow**: a "Conversation | Details" segmented switch under the hero. Both panes stay mounted.

Sections with nothing in them leave the list and appear as chips under a **"Nothing here yet"** heading at the end of their column. Each chip shows icon, title and the section's add "+"; clicking the chip title opens the section in place.

**Timeline tile:**

- No subtitle.
- Filter chips hide lanes with a count of 0, except the active one.
- System events that only restate a reply (`TICKET_COMMENT_ADDED`, `TICKET_MESSAGE_ADDED`, `TICKET_CUSTOMER_REPLIED`, `TICKET_INTERNAL_NOTE_ADDED`) are dropped from the bento timeline, so lane counts add up. Entry layout's activity timeline is unaffected.
- The composer entry follows sort order. Newest-first shows an inline "Reply to ‹first name›" prompt at the top (styled like the docked composer, not a primary button). Oldest-first keeps the composer docked at the bottom (the newest end) at all times.
- Reply rows have no spine pin (the avatar marks them). Time, system and alert rows keep the pin.
- Thread replies indent one level at most; deeper replies render flat at that level.

**Compact comment rows** (`CommentItem` `variant="compact"`, used only by the bento timeline):

- a left accent rule instead of a boxed card
- a single header line: name truncates, the timestamp sits flush right
- the response source as an icon with a tooltip
- the Text/Email switch revealed on hover or focus only
- with no reactions yet, React moves into the hover toolbar

## Mechanisms (the general pieces)

These are the reason this is more than a restyle. Each solves the concrete problem and makes a class of future placement problems trivial.

1. **`ActionSurface` / `ActionTrigger`** (`packages/ui/src/components/ActionSurface.tsx`, new). An injected feature declares its entry point as `<ActionTrigger id icon label onClick />`. The host that places it decides the presentation through `<ActionSurface kind="bar" | "tile">`: `bar` is a soft small button, `tile` is a "+ label" primary-coloured text link.
   - This replaces each dialog's own hard-coded trigger `Button`, so self-contained trigger-plus-dialog features (Receive equipment, Quick invoice, Create Task, Link to Task) can be placed in a tile without new props.
   - `TicketLinkedTasksBadge` reads the surface: inside a tile it renders the linked-task list inline instead of a popover button.
2. **`ContentCardFooter`** (in `ContentCard.tsx`). Lets a host append actions under an injected `ContentCard` it doesn't own. The nearest card consumes it, and nested cards see none. The bento layout uses it to put Receive equipment under the injected Assets card.
3. **`BentoBoard`** (`packages/ui/src/components/bento/BentoBoard.tsx`, new). Tiles are declared once as `{ key, zone: 'start' | 'end', group, rank, pinned?, node }`, with `groups` (ordered and labelled), `breakpoints`, `emptyShelfLabel` and `narrowTabs`. A `ResizeObserver` on the board picks the tier.
   - **One parent per column.** Each column is a single flex-wrap parent, and tiles are ordered with CSS `order`. Moving a tile between the live list and the shelf therefore never remounts it, which would refetch and flicker. Section labels are computed from live tiles only.
   - **Board slots.** Each tile is wrapped in a slot (`BentoBoardSlotContext`: `{ report(empty), shelved, open() }`). Opened sections stay on the board while still empty.
4. **Self-reporting empty sections.**
   - `BentoTileEmpty` reports up to its `BentoTile`. Under `BentoCollapseEmptyTiles` (opt-in; only the ticket board turns it on), a tile whose body is only its empty state collapses to a single header line.
   - `BentoTile` also reports to the board slot. A collapsible `ContentCard` with `count === 0` reports too.
   - When shelved, both render `BentoShelfChip`. The body stays mounted but hidden, so the section reports when content arrives.
   - `BentoTileEmptyScope` stops a sub-section's empty state from collapsing the whole tile. It is used for the contact-none line, the empty timeline and the billing rollup.
5. **Stopwatch chip** (`TicketStopwatchControls` gains `variant: 'chip' | 'notes'`).
   - `chip`: clock plus play/pause/stop/discard in the hero. Clicking the clock opens a popover holding the work description.
   - When the user's session runs on another ticket or task, the chip shows "Timer on #N" (full sentence as tooltip) and **Switch here**, which opens the existing switch dialog. **Regression guard:** the spike dropped Switch here once; this must have a test.
   - `notes`: the description-only body, used in the Time tile only when the board's stopwatch is off.
   - Leave the `// LEVERAGE: pattern stopwatch-controls` marker; the chip and tile button clusters are duplicates.
6. **`HybridThreadNode` `maxIndentDepth`.** Replies below the given depth render flat at that depth, with no further indentation or thread bar.

## File-by-file changes

**`packages/ui`**

- `components/ActionSurface.tsx` (new): see Mechanisms 1.
- `components/bento/BentoBoard.tsx` (new), `bento/BentoTile.tsx`, `bento/index.ts`: see Mechanisms 3–4. `BentoTileAddButton` gains `busy` (disabled, with a spinner in place of the "+"); the Time tile uses it while a time entry launches. Export `BentoBoard`, `BentoBoardTile`, `BentoBoardTier`, `BentoTileEmptyScope` and `BentoCollapseEmptyTiles`.
- `components/ContentCard.tsx`:
  - add `ContentCardFooter`
  - report to the board slot, and render the shelf chip when shelved (after all hooks)
  - the bento-variant header add button becomes an icon-only ghost "+"; the default variant is unchanged
  - export from `components/index.ts`
- `components/HybridThreadNode.tsx`: `maxIndentDepth` (Mechanisms 6).
- `components/TreeSelect.tsx`:
  - **both** trigger branches use `border border-border`, `min-h-[36px]` (matching `CustomSelect`)
  - the selected label truncates (`min-w-0 overflow-hidden` on `Value`, `block truncate` on the span, and `min-w-0 gap-2 overflow-hidden` on the trigger)
  - the spike first missed the second branch; check both
- `components/UserAndTeamPicker.tsx`: `size="sm"` uses `h-9`, normal weight and `border-border`, matching `CustomSelect`.
- `components/ViewSwitcher.tsx`: the compact (`sm`) variant uses `soft` for active and `ghost` for inactive, so inline switchers never compete with the screen's primary action. The default size is unchanged.
- `components/BackNav.tsx`: optional `variant` (`soft` | `ghost`) and `size` props.

**`packages/tickets`**

- `ticket/TicketDetails.tsx`:
  - compact `BackNav`
  - in Grid mode, hide the number, origin badge and reply-state badge from the header row
  - extract `moreActionsMenu` (Print work tag, Duplicate, template, workflow, separator, Delete) and use it in the Entry header and the Grid hero
  - extract `ticketOriginBadge`
  - in Grid mode, fold the created/updated stamps into `heroMeta` (relative text, absolute tooltip)
  - live status: a dot in the Grid header, the existing pill in Entry
  - dark-mode classes for the close-rules banner and the checklist progress chip (amber/green at 10% background, 40% border, light text)
- `ticket/bento/TicketBentoLayout.tsx`:
  - build `sideTiles` for `BentoBoard` (table above), with section labels "Customer / Work / People / Linked items", `emptyShelfLabel` "Nothing here yet", `narrowTabs` "Conversation / Details" and breakpoints `{ medium: 760, wide: 1440 }`
  - mount the quick-add-contact and log-interaction dialogs outside the board (`sideTileDialogs`), so a tier change never remounts an open dialog
  - **Time & billing** tile ("Time logged" when billing is hidden):
    - header "+" adds a time entry
    - the summary shows the logged total, other members' entries and a Billing section (`BillingSummary`) with Quick invoice under `ActionSurface kind="tile"`
    - the standalone Billing tile is removed from the board
  - **Project tasks** tile (new): the injected task actions under `ActionSurface kind="tile"`
  - **Assets:** wrap the injected node in `ContentCardFooter` with Receive equipment
  - pass `heroMeta`, `heroMoreActions`, `timerControl` (the chip) and `customerLabel` to the hero
  - wrap the board in `BentoCollapseEmptyTiles`, and add `BentoTileEmptyScope` around the contact-none lines
- `ticket/bento/descriptionContent.ts` (new): `hasDescriptionContent`, the description-emptiness rule below.
- `ticket/bento/BentoHero.tsx`:
  - the title row, metadata row, field grid, description and empty prompt as described in Target layout
  - drop the props `taskActions`, `quickInvoiceActions` and `receiveEquipmentActions`
  - add the props `heroMeta`, `moreActions`, `timerControl` and `customerLabel`
  - the Grid "Updated" stamp uses the shared `fields.updatedAtBy` string ("Updated ‹relative› by ‹name›")
  - **fix `hasDescription`** (via `hasDescriptionContent`): a parsed-but-empty description (a paragraph holding an empty text run) must count as empty. Walk the blocks and count only non-blank text or a non-text node (image, mention and so on). The old check counted any non-empty `content` array.
- `ticket/bento/dataTiles.tsx`: split `BillingTile` into `BillingSummary` (body, with a `footer` prop) plus a thin `BillingTile` wrapper. Scope the "Nothing billable yet" empty state.
- `ticket/bento/SlaClocksTile.tsx`: return `null` when no policy applies.
- `ticket/bento/BentoTimelineTile.tsx`, `timelineHelpers.ts`: timeline behaviour as described above. Add `isReplyEchoEvent` to the helpers. The inline reply prompt replaces the "Add Comment" button (keep the id `${id}-add-comment-btn`). Use `maxIndentDepth={1}`.
- `ticket/CommentItem.tsx`: compact-row changes as described above.
- `ResponseSourceBadge.tsx`: `size="icon"`.
- `ticket/TicketStopwatchControls.tsx`: see Mechanisms 5.
- `ticket/bento/LayoutToggle.tsx`: `size="sm"`.
- `CategoryPicker.tsx`: the selected label renders as plain "Parent › Child", not bold-parent "Parent → Child".

**Injected features** (trigger only, so the dialogs are unchanged): `billing/.../QuickInvoiceTicketDialog.tsx`, `projects/.../CreateTaskFromTicketDialog.tsx`, `projects/.../LinkTicketToTaskDialog.tsx`, `msp-composition/.../ReceiveEquipmentDialog.tsx` switch to `ActionTrigger`. `projects/.../TicketLinkedTasksBadge.tsx` adds the tile-surface list rendering.

**Entry layout (`TicketInfo`)** keeps its own action row for this change. Its injected triggers render as `bar` (the default surface), so they look as before.

## i18n (done)

Keys were added to all locales (`server/public/locales/{en,fr,es,de,nl,it,pl,pt,sv}`), the pseudo-locales (`xx`, `yy`) were regenerated with `node scripts/generate-pseudo-locales.cjs`, and `node scripts/validate-translations.cjs` passes. New keys:

- **`features/tickets`:**
  - `bento.tiles.timeAndBilling`, `bento.tiles.projectTasks`, `bento.tiles.addDescriptionPrompt`
  - `bento.groups.customer`, `bento.groups.work`, `bento.groups.who`, `bento.groups.linked`, `bento.groups.empty`
  - `bento.board.conversation`, `bento.board.details`
  - `liveUpdates.connection.offlineShort`
  - `stopwatch.chipElsewhere`, `stopwatch.title`
- The `msp/assets` and `common` keys are reused, with no new keys there. The compact comment's React label uses `common:reactions.add`.

## Tests (done)

Results:

| Package | Tests | Change |
|---|---|---|
| tickets | 1452 | 13 new |
| ui | 785 | 14 new |
| projects | 570 | unchanged |
| billing | 2541 | unchanged |
| assets | 421 | unchanged |

The server contract tests that touch these files pass. One `msp-composition` file (`MspClientCrossFeatureProvider.hourBlocksInjection.test.tsx`) fails to load in this copy because `@alga-psa/workflow-streams` is not built. That is unrelated and pre-existing.

The baseline before the work: all of tickets passed. The changed contracts broke 61 tests; every one was traced to a deliberate design change and updated, and none was a logic regression.

- **Test mocks:** mocks of `@alga-psa/ui/components/bento/BentoTile` and `withDataAutomationId` now spread `importOriginal()`, so new exports don't break them.
- **`ResizeObserver`:** `BentoBoard` tolerates its absence (jsdom, older runtimes).

What the new and updated tests cover:

- **Unit (ui):** `bento/BentoBoard.test.tsx`, `ActionSurface.test.tsx`
  - `BentoBoard` tier selection by width (wide, medium, narrow)
  - group/rank ordering, and a section label only before the first live tile of a group
  - an empty-reporting tile moves to the shelf without remounting (a mount counter)
  - `open()` keeps an empty section on the board
  - the narrow switch keeps both panes mounted
  - `BentoTile` collapses only under `BentoCollapseEmptyTiles`, and `BentoTileEmptyScope` blocks it
  - `ContentCardFooter` is consumed by the nearest card only
  - `ActionTrigger` renders per surface
  - `HybridThreadNode` `maxIndentDepth` flattens
- **Unit (tickets):** `TicketStopwatchControls.test.tsx` (chip and notes), `descriptionContent.test.ts` (the extracted `hasDescriptionContent`), `timelineHelpers.test.ts`, `SlaClocksTile.test.tsx`, `BentoTimelineTile.composerHeading.test.tsx` (placement and lane chips)
  - `hasDescription` is false for an empty paragraph and for whitespace-only text, and true for text and for an image block
  - `isReplyEchoEvent`
  - zero-count lane chips hidden except the active one
  - the composer position follows the order
  - **the stopwatch chip shows Switch here when the session runs on another ticket, and clicking it calls `stopwatch.start` with the switch flow**
  - `SlaClocksTile` renders nothing without a policy
- **Updated existing tests (moved or removed elements):**
  - `BentoHero.unsavedChanges.test.tsx`
  - `BentoHero.activityGroup.test.tsx`
  - `TicketBentoLayout.addTimeEntry.test.tsx` (Add time entry is now the Time tile's header "+")
  - `TicketBentoLayout.locationBilling.test.tsx`
  - `BentoTimelineTile.composerHeading.test.tsx`
  - `BentoResolutionClose.contract.test.ts`
  - any test matching the old "Add Comment" button text, or the header Print/Duplicate/Delete buttons (now ⋯ menu items with the same ids)
- **Manual smoke (dev stack):**
  - widths of 1920, 1600, 1280 and 1024, in light and dark
  - a ticket with a running stopwatch on another ticket (Switch here, then cancel)
  - a long title alongside the elsewhere chip and the My group control
  - an empty ticket (shelf chips; clicking a chip opens its section)
  - Receive equipment from the Assets tile, Quick invoice from Time & billing, Create/Link Task from Project tasks
  - Delete from the ⋯ menu opens the dependency-checked dialog

## Risks and notes

- **Remount on tier change.** Tiles remount when the board crosses a tier, because they move between columns. Dialogs are mounted outside the board for that reason.
  - Before measuring, the board renders in the tier it last measured for that board id (a module-level memory, defaulting to `wide`). So only the first ticket view after a page load can mount its tiles twice and refetch once.
  - Moving a section to or from the empty shelf never remounts it (a CSS `order` change within one parent; covered by a test).
- **Shared-component visual changes reach other screens.** These alter any screen using the components:
  - `TreeSelect` border and height
  - `UserAndTeamPicker` `size="sm"`
  - `ViewSwitcher` `size="sm"`
  - `ContentCard` bento add button

  Spot-check the asset, contact and client bento screens and any `TreeSelect` form.
- `CommentItem` compact is used only by the bento timeline; the full variant is untouched.
- `BentoCollapseEmptyTiles` is deliberately opt-in. Other bento boards can adopt it once their tiles are checked to put nothing but the empty state (and its add link) in an empty body.

## Out of scope (recorded judge findings, possible follow-up)

These came up repeatedly in the last rounds and were explicitly not taken:

- Timeline row density: header-to-body gap; folding quoted email tails behind "…"; a labelled channel/visibility pill instead of glyphs. Also, timestamps still stop short of the row's right edge, because the hidden hover toolbar reserves space.
- One tile-action contract: a single header "+", or a split "+▾" menu when a tile has several create actions (Assets: Link / Receive equipment; Project tasks: Create / Link).
- Team as an avatar stack beside Assigned to (removing the People section), and Team rendered as a read view instead of a live multi-select.
- A one-line time summary ("3h logged · 3h billable · not invoiced"). Also fix the "1 entries" pluralization.
- A public/internal mode toggle on the collapsed composer bar.
- Raw IDs: the global top bar shows a raw UUID chip next to the breadcrumb on every page. It is outside this layout, but it violates the no-raw-IDs rule; worth its own card.
