# F010 / T005 — why the shell extraction is blocked, not merely unstarted

**Rows:** `ticketList:F010`, `ticketList:T005` (both `missing-code`, unchanged).
**Kind:** code read. This establishes what exists and what obstructs; it proves
nothing passes and moves no row. Re-runnable by re-reading the cited lines.

## The requirement

> **F010** — Extract a presentational `TicketListShell` **from the actual
> dashboard frame** with heading/actions, scope, board, toolbar and results
> slots **while preserving native structure and IDs**.

> **T005** — **Render the native dashboard through the new frame** and retain
> representative board tabs/default arrivals, native filter chips, indexed-comment
> search request, bundle expansion, metadata and client quick view.

## What actually happened

`TicketListShell` was written as a **parallel frame**, not extracted. Its only
consumer is the qualified co-managed list:

- `packages/tickets/src/components/TicketListShell.tsx:32-66` — the frame.
- `server/src/components/co-managed/QualifiedTicketList.tsx:22, :346` — the sole
  import and sole render.
- `packages/tickets/src/components/TicketingDashboard.tsx` — **3123 lines, zero
  occurrences of `TicketListShell`** (`grep -n TicketListShell` returns nothing).

So F010 is unmet as written, and T005 has no subject: there is no "native
dashboard rendered through the new frame" to test. Both rows are correctly
`missing-code` and stay there.

**F010 is not satisfied by the parallel frame.** The header markup matches
closely enough to show the shell was written *by copying* the dashboard's
heading — same `h1` classes, same actions wrapper — which is evidence of
duplication, not of extraction.

## The part that is new: the extraction is *blocked*, not just undone

The previous round recorded "nothing was extracted". Reading both frames
side by side shows something more actionable — **the shell as currently designed
cannot host the dashboard at all**, so F010 is not a matter of finding the time
to wire it up.

The dashboard frame (`TicketingDashboard.tsx`):

| line | element |
|---|---|
| 2195 | `<ReflectionContainer id={id} label="Ticketing Dashboard">` — the root |
| 2196-2200 | heading `<div>` + `<h1>` + actions `<div className="flex items-center gap-3">` |
| 2250 | `{scopeControls}` — rendered **bare**, no wrapper |
| 2251 | `<BoardTabStrip>` — **outside** the card |
| 2257 | `<div className="bg-[rgb(var(--color-card))] shadow rounded-lg">` — the card |
| 2263 | `<BoardHeader>` — **inside** the card |
| below | sticky toolbar, then the results table — both **inside** the same card |

`TicketListShell` renders its slots as **flat siblings** (`:44-65`): root `div`,
heading, `scope`, `board`, `toolbar`, `children`. Three concrete conflicts:

1. **The card surface has no slot.** The dashboard groups `BoardHeader` +
   toolbar + results inside one `rounded-lg` card (2257), while `BoardTabStrip`
   sits outside it (2251). The shell emits `board`, `toolbar` and `children` as
   three siblings with no wrapper, so this grouping is inexpressible. This is
   the blocking one — and F010 requires *preserving native structure*.
2. **The root id would be duplicated.** The shell owns
   `<div id={id} data-automation-id={id}>` (`:45`); the dashboard's root is a
   `ReflectionContainer` already carrying `id`. F010 requires *preserving IDs*.
3. **The scope wrapper changes spacing.** The shell wraps `scope` in
   `<div className="mb-4">` (`:61`); the dashboard renders `scopeControls` bare.

(The heading's `justify-between items-center` vs `flex justify-between
items-center` ordering differs textually but computes identically — cosmetic,
not a conflict.)

## What this means for the plan

The layering rule on this project is that the abstraction serves the
application: if the engine cannot accommodate the design, **the engine changes**.
So the correct resolution is *not* to reword F010 down to what the parallel
frame already does. It is to revise `TicketListShell` so it can express the
native structure — most likely a surface/card slot that can contain board
header, toolbar and results together, plus letting the caller own the root
element and the scope spacing — and only then render the dashboard through it.

**Not done this round, and deliberately so.** That change rewrites the frame of
the primary PSA ticket screen, and there is no component render test over
`TicketingDashboard` that would catch a DOM or automation-id regression: the
sibling files are contract and i18n tests (`TicketingDashboard.category.contract.test.ts`,
`.moveBulk.contract.test.ts`, `.i18n.test.ts`, `.closedMasterI18n.test.ts`,
`TicketingDashboardContainer.urlSync.contract.test.tsx`), none of which render the
frame. Performing an unverifiable restructure of that screen would be a worse
outcome than reporting the obstacle precisely.

**Recommended next step, in order:** (1) revise `TicketListShell` to carry the
card surface and to stop owning the root id; (2) add a render test over
`TicketingDashboard`'s frame that pins the heading, the board strip position,
the card boundary and the automation ids; (3) only then route the dashboard
through the shell and let T005 assert it. Step (2) before step (3) is the same
ordering this round applied to T007/T010/T012/T015 — protect the coverage before
you move its subject.

Because the shell's contract is what changes, this is a PRD-level revision of
`F010`'s implementation route rather than a silent inventory edit; `F010` and
`T005` keep their `missing-code` status until the dashboard actually renders
through the frame.
