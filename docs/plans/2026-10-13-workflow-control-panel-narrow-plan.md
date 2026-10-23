# Workflow Control Panel: Events and Dead Letter tabs at narrow widths

Card: b6e992f1-66f2-4023-a817-6273f32810a5 · Ticket: alga0002106 (follow-up to PR #3675, review guide step 6)
Branch: `feature/workflow-control-panel-events-and-dead-letter-de`

## Problem

On Automation → Workflow Control Panel, selecting a row on the **Events** or **Dead Letter** tab opens a
detail column to the right of the list. At ~960px with the sidebar expanded, and at ~768px, there isn't
room for both, so the page scrolls sideways. The filter card's export buttons and the table's leading
columns get clipped, and the detail, including "Workflows not launched" from #3675, sits partly off-screen.

## Root cause

Both tabs use the same layout:

| File | Line | Markup |
|---|---|---|
| `ee/server/src/components/workflow-designer/WorkflowEventList.tsx` | 456 | `<div className="flex h-full gap-4">` |
| same | 457 | list: `flex-1 min-h-0 flex flex-col gap-3` (no `min-w-0`) |
| same | 575–576 | detail: `{selectedEventId && <div className="w-[480px] shrink-0 overflow-auto space-y-4">` |
| `ee/server/src/components/workflow-designer/WorkflowDeadLetterQueue.tsx` | 103 | `<div className="flex h-full gap-4">` |
| same | 104 | list: `flex-1 space-y-3 overflow-hidden` |
| same | 188–189 | detail: `{selectedRun && <div className="w-[480px] shrink-0 overflow-auto">` |

Two separate faults combine:

1. **Intrinsic width propagates upward.** The list is a flex item with the default `min-width: auto`,
   so it can't shrink below its content's min-content width. The detail never shrinks either: it has a
   fixed 480px width plus `shrink-0`. The sum of the two becomes the min-content width of every ancestor,
   up to the MSP page's main column, which has no `min-w-0` of its own. The result is a page-level
   horizontal scrollbar. The `overflow-hidden` on the tab content wrapper
   (`WorkflowDesigner.tsx:6148`) doesn't help. It only zeroes that element's own *automatic minimum*;
   ancestors still see the min-content contribution of its descendants.
2. **There's no narrow mode.** Even with a shrinkable list, a 480px detail next to a list in a ~650px
   container leaves the list unusable.

`DataTable` already adapts to its width. It measures its container with a `ResizeObserver`
(`packages/ui/src/components/DataTable.tsx:375–395`) and hides columns that don't fit, showing the
"N columns hidden · Show all" strip. It only needs to be *given* a smaller width. The Dead Letter list uses a
plain `Table` inside `overflow-auto` (`WorkflowDeadLetterQueue.tsx:124`), which scrolls inside its own
card once its parent can shrink.

## Decisions

### D1. One shared layout component: `ListDetailLayout` in `@alga-psa/ui`

New file: `packages/ui/src/components/ListDetailLayout.tsx`, exported like its sibling components
(`@alga-psa/ui/components/ListDetailLayout`). The same structure appears in two places
(`WorkflowEventList.tsx:456–711`, `WorkflowDeadLetterQueue.tsx:102–198`), and nothing in it is specific
to workflows. It's a general list/detail layout, so it belongs in the UI layer rather than as a third
local copy in `workflow-designer/`.

```tsx
interface ListDetailLayoutProps {
  id: string;                     // automation id root; children get `${id}-list`, `${id}-detail`, `${id}-back`
  list: React.ReactNode;
  detail: React.ReactNode | null; // null/undefined = nothing selected → list only
  onBack: () => void;             // stacked-mode Back control; callers pass the same handler as Close
  backLabel: string;              // translated by the caller (ui package stays namespace-agnostic)
  className?: string;
}
```

Structure (Tailwind; `@tailwindcss/container-queries` is already registered in
`server/tailwind.config.ts:3`, its `content` globs already cover `packages/ui` and `ee/server/src`, and
`@container` is already used by `ContentCard.tsx:136`):

```tsx
<div id={id} className="@container h-full min-h-0 min-w-0">
  <div className="flex h-full min-h-0 gap-4">
    <div id={`${id}-list`}
         className={cn('min-h-0 min-w-0 flex-1 flex-col', hasDetail ? 'hidden @[56rem]:flex' : 'flex')}>
      {list}
    </div>
    {hasDetail && (
      <div id={`${id}-detail`}
           className="flex min-h-0 min-w-0 flex-1 flex-col @[56rem]:flex-none @[56rem]:w-[clamp(22.5rem,38%,30rem)]">
        <Button id={`${id}-back`} variant="ghost" size="sm" onClick={onBack}
                className="mb-2 self-start @[56rem]:hidden">
          <ArrowLeft className="h-4 w-4" /> {backLabel}
        </Button>
        <div className="min-h-0 flex-1 overflow-y-auto space-y-4">{detail}</div>
      </div>
    )}
  </div>
</div>
```

Why this shape:

- **`container-type: inline-size` on the root (`@container`) fixes fault 1 by itself.** Inline-size
  containment means the root's min-content contribution no longer depends on its contents, so nothing
  inside can widen the page again. The `min-w-0` on both flex children then lets them actually shrink.
- **The breakpoint is the container width, not the viewport.** The app often runs in split panes and with
  the sidebar open, so `md:`/`lg:` viewport breakpoints would pick the wrong mode. The breakpoint lives
  in one place, the layout component.

### D2. Narrow mode is a stacked view (detail replaces the list, with a Back control), not a Drawer

Below the breakpoint, when an item is selected, the list is hidden with `display:none` and the detail
fills the container. A Back button appears above the detail.

I rejected an overlay `Drawer` (`packages/ui/src/components/Drawer.tsx`) for this:

- `Drawer` is a portal pinned to the **viewport** (`fixed inset-y-0 right-0`, default width `w-fit max-w-[60vw]`).
  The goal is pane-relative behaviour. In a split pane, a viewport drawer covers neighbouring UI, and at
  768px `max-w-[60vw]` is about 460px, which is as cramped as the current column.
- Switching between an inline column and a portal drawer needs JS width measurement and remounts the
  detail when the mode changes. That loses its state: an open "View run details" panel and scroll
  position. It also means a measurement flash on first paint, which matters most for deep links.
- The stacked view is pure CSS, renders correctly on first paint, keeps one mounted detail tree across
  resizes, and gives the detail the **full** container width. The event detail can embed
  `WorkflowRunDetailsPanel`, which is large, so that width matters.
- The list stays mounted while hidden. Filters, page, and sort state survive the round trip through the
  detail. `DataTable` already handles being measured at width 0 by keeping its current column set
  (`DataTable.tsx:488–489`).

### D3. Breakpoint and side-by-side widths

- **Breakpoint: container ≥ 56rem (896px) → side by side; below → stacked.** At 56rem the detail's
  lower clamp of 22.5rem (360px) still leaves the list about 520px. `DataTable` shows 3–4 of the 7 Events
  columns at that width, and the Dead Letter table scrolls within its card.
  - 1920px viewport with sidebar → container is roughly 1600px → side by side.
  - ~967px pane with sidebar → container is roughly 650–700px → stacked.
  - 768px → stacked.
  - Implementation must confirm these container widths in the browser and adjust the single constant
    if 1280–1440px viewports with the sidebar open land on the wrong side.
- **Detail width: `clamp(22.5rem, 38%, 30rem)`.** The 30rem cap is exactly 480px, so the 1920px layout
  looks the same as today (acceptance: "at 1920 the current side-by-side layout is preserved"). Between
  the breakpoint and ~1260px of container width, the detail shrinks proportionally instead of crowding
  the list.

### D4. Selected event is driven by the URL (`eventId`), so deep links, Close, and Back stay consistent

Current behaviour (`WorkflowEventList.tsx:170–172`): `eventId` is read from `window.location` **once**,
in a `useState` initializer. This has three defects that the narrow-mode navigation makes worse:

- **Close leaves `eventId` in the URL** (`:580`). A reload reopens the detail.
- **Clicking a row doesn't write `eventId`** (`:554`), so the URL never matches the screen.
- **Following "Open event" while the control panel is already mounted** (for example from
  `WorkflowLaunchSkipsDrawer.tsx:200` in another client navigation) doesn't re-run the initializer, so
  the link is ignored.

Change: read the selection from `useSearchParams().get('eventId')` (from `next/navigation`) and write it
with `router.replace` through one `selectEvent(id | null)` helper that preserves the other params
(`section`). `replace` matches the existing tab-change handler (`WorkflowDesigner.tsx:2125–2142`) and
keeps Back/Close from piling up history entries. Row click, Close, and the stacked-mode Back all go
through `selectEvent`. The two fetch effects (`:296–323`) keep keying off the derived id, unchanged.

Paired fix in `WorkflowDesigner.tsx:2131`, `handleControlPanelTabChange`: delete `eventId` from the
params when the next section isn't `events`, so a stale selection doesn't follow the user to other tabs
and back.

Dead Letter selection stays local state (`WorkflowDeadLetterQueue.tsx:68`). The card has no deep link
for it, and adding a `runId` param is out of scope.

### D5. Filter card wraps instead of clipping

Once fault 1 is gone, the existing `flex flex-wrap` row (`WorkflowEventList.tsx:459`) wraps on its own.
The `ml-auto` export group (`:517`) drops to its own line. Two small changes make it wrap cleanly:

- `:517` export group: add `flex-wrap` so "Export CSV" / "Export JSON" can wrap under each other in the
  narrowest stacked list (~480px containers).
- `:466`, `:474` search inputs (`w-56`, `w-48`): add `max-w-full` so a single input never exceeds the
  card width.

The Dead Letter filter row (`WorkflowDeadLetterQueue.tsx:106–107`) already wraps
(`flex-wrap`, `min-w-[220px]`). No change is needed beyond the layout.

### D6. Focus and scroll on mode transitions (stacked mode only)

- **Opening a detail in stacked mode:** the detail scroll container starts at the top. Because the
  detail is conditionally mounted per selection, it does so naturally. Focus moves to the Back button,
  because the row the user clicked is now `display:none` and focus would otherwise drop to `<body>`.
  In side-by-side mode, focus stays where it is. The layout can tell which mode it's in by checking
  whether the Back button is visible (`offsetParent !== null`) in a layout effect keyed on `detail`
  presence, so there's no width measurement.
- **Back:** focus returns to the list container (`${id}-list`, `tabIndex={-1}`). Restoring focus to the
  exact `DataTable` row is not possible with the current `DataTable` API.

## Changes by file

1. **`packages/ui/src/components/ListDetailLayout.tsx` (new):** the component from D1, with D6 focus
   handling. Uses `Button` and `lucide-react` `ArrowLeft`. Register for UI reflection like other layout
   containers if that's the convention for non-interactive wrappers; the Back `Button` registers itself.
   Add it to the components index/exports the same way the neighbouring components are.
2. **`ee/server/src/components/workflow-designer/WorkflowEventList.tsx`:**
   - `:170–172` replace the `useState` initializer with the URL-derived `selectedEventId` and add a
     `selectEvent` helper (D4).
   - `:455–457`, `:573–576`, `:710–712` replace the hand-rolled flex row with
     `<ListDetailLayout id="workflow-events-layout" list={…} detail={selectedEventId ? <…detail cards…/> : null}
     onBack={() => selectEvent(null)} backLabel={t('eventList.actions.backToEvents', { defaultValue: 'Back to events' })} />`.
     The detail content (`:577–709`) moves over unchanged, including the "Workflows not launched" block
     `#workflow-event-detail-launch-skips` and the nested `WorkflowRunDetailsPanel`.
   - `:554`, `:580` route row click and Close through `selectEvent`.
   - `:466`, `:474`, `:517` filter wrapping (D5).
3. **`ee/server/src/components/workflow-designer/WorkflowDeadLetterQueue.tsx`:**
   - `:102–104`, `:186–198` replace with
     `<ListDetailLayout id="workflow-dead-letter-layout" list={…} detail={selectedRun ? <WorkflowRunDetailsPanel …/> : null}
     onBack={handleRunDetailsClose} backLabel={t('deadLetter.actions.backToList', { defaultValue: 'Back to dead letter' })} />`.
   - The list's `overflow-hidden` (`:104`) is replaced by the layout's list column. The table keeps its
     own `overflow-auto` (`:124`).
4. **`ee/server/src/components/workflow-designer/WorkflowDesigner.tsx:2131`:** strip `eventId` when
   leaving the events section (D4).
5. **i18n:** add `eventList.actions.backToEvents` and `deadLetter.actions.backToList` to the
   `msp/workflows` namespace in `server/public/locales/*/msp/workflows.json`, for every locale per
   `docs/AI_coding_standards.md` §i18n. Then run `node scripts/validate-translations.cjs`.

## Tests

- **`packages/ui/src/components/ListDetailLayout.test.tsx` (new, jsdom):**
  - With `detail` null, only the list renders and there's no Back button.
  - With `detail` set, both regions render, and the list carries the `hidden @[56rem]:flex` classes.
  - Back calls `onBack`.
  - Ids are derived from `id`.
  - jsdom can't evaluate container queries, so mode switching is covered by the browser checks below.
- **`ee/server/src/components/workflow-designer/__tests__/WorkflowEventListLaunchSkips.test.tsx`:** it
  currently seeds `eventId` through `window.history.replaceState`. Switch it to mocking
  `next/navigation` (`useSearchParams`, `useRouter`) and keep all existing assertions.
- **New test in the same folder:**
  - Close/Back call `router.replace` with `eventId` removed and `section` preserved.
  - Clicking a row writes `eventId`.
  - Changing `eventId` in the search params while mounted swaps the detail (the "Open event" while
    already mounted case).
- **`WorkflowDesigner` tab-change test:** add a case to an existing designer test showing that leaving
  `events` drops `eventId`.
- **Browser evidence for the review packet** (dev origin
  `http://feature-workflow-control-panel-events-and-dead-letter-de.localhost:3283`):
  - Events with `?section=events&eventId=<id with launch skips>`, sidebar expanded, at **1920, ~960,
    and 768**.
  - Dead Letter with a run selected, at the same three widths.
  - At each width, assert `document.documentElement.scrollWidth <= clientWidth` (no horizontal page
    scroll). Also confirm that "Workflows not launched", Export CSV/JSON, and Back are fully visible.
  - Also screenshot a ~1100px viewport, which is side by side near the breakpoint, to check the clamp.

## Out of scope (flag in review if still present)

- **Workflow list (Workflows tab / `WorkflowListV2`):** the hidden Name column at narrow widths
  ("Show all" strip) and the "N skipped" badge clipping in the fixed 120px Status column.
- **Dead Letter deep link (`runId` param).**
- **`WorkflowRunDetailsPanel` internal grids:** they use *viewport* breakpoints
  (`WorkflowRunDetailsPanel.tsx:1103, 1328, 1357, 1593` `md:grid-cols-4` / `md:grid-cols-2`), so in the
  480px side column at desktop widths they render 4-up in a narrow box. This predates this card, isn't
  clipping, and the stacked mode gives the panel full width at narrow sizes. Converting them to container
  queries is a natural follow-up.
- **Runs tab (`WorkflowRunList`):** not reported, so not touched.

## Risks

- **Container-query breakpoint choice.** Container widths at 1280–1440px viewports with the sidebar
  depend on the shell's padding and sidebar width. Mitigation: the value lives in one place, and the
  browser checks above include a near-breakpoint width.
- **Inline-size containment side effects.** `@container` blocks the root from sizing to its content
  horizontally. It's a block filling a `h-full` tab panel, so nothing should depend on its shrink-to-fit
  width. The Tailwind plugin also sets no block-size containment, so `h-full` still works.
- **Hidden-list measurements.** While the list is `display:none`, `DataTable`'s `ResizeObserver` reports
  width 0. It already keeps its current column set in that case, so after Back it re-measures
  without flicker. If it doesn't, the fix belongs in `DataTable`, not in the callers.
- **URL-driven selection re-renders.** `router.replace` on every row click triggers a soft navigation of
  `/msp/workflow-control`. `WorkflowDesigner` is a client component and stays mounted, and the event list
  reads from `useSearchParams`, so this costs one RSC round trip for the page. Verify there's no visible
  refetch or flash of the events list. If there is, fall back to `window.history.replaceState`, which
  Next 14+ syncs to `useSearchParams`.
- **Focus heuristics (D6)** rely on the Back button's computed visibility. That's cheap and
  measurement-free, but it needs a check in both modes with a keyboard-only pass.
