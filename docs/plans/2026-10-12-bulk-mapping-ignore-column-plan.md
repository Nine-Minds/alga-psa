# Bulk mapping grid: keep the Ignore column visible at narrower pane widths

Card d9e0fc37 · PSA ticket alga-2026-0002680 · stacked on card 6a05578a (PR #3634)

## Why Ignore disappears

The grid lives in
`packages/integrations/src/components/accounting-mappings/AccountingMappingBulkGrid.tsx`
(`columns` useMemo, lines 234-398). It renders a shared `DataTable`. That table decides
which columns to show using `computeColumnFit` in
`packages/ui/src/components/dataTableColumnFit.ts`.

How `computeColumnFit` works today:

1. **Priority order.** A column whose `dataIndex` is `id` comes first. Columns with an explicit
   `width` come before columns without one. Otherwise the order is stable, so declaration order
   holds. For this grid the order is:
   Status (`dataIndex: 'id'`, 280) → Save 96 → name 220 → Map To 160 → Xero Target 520 → Ignore 96.
2. **Greedy admission at preferred size.** Columns are added in that order while
   `used + size <= containerWidth`. The first column that does not fit can shrink into the
   leftover space if `remaining >= minSize`. Every column after it is hidden behind the
   "N columns hidden. Show all" banner.
3. **Floors.** `getColumnSizeConfig` clamps every non-compact column to `[96, 520]`.
   Only the hard-coded compact ids (`select`, `checkbox`, `actions`, …) can go narrower.

The sum is 1372px and Ignore comes last in priority, so Ignore is hidden whenever the
container is under 1372px. The fit engine never shrinks a column it has already admitted, so
the 520px Xero Target column cannot give up space to keep Ignore on screen. No width
setting in the grid fixes this on its own. With the current engine there are only two
options. One is to drop Target's `width` so it sorts last in priority and becomes the column
that shrinks. That relies on an undocumented ordering rule, and Target would stop stretching.
The other is to shrink every column until the worst case fits, which wastes space at wide
widths. The engine is what needs to change. This is a
`// LEVERAGE: friction datatable-fit-no-flex-columns`.

Container width estimates: the sidebar is 256px expanded and 64px collapsed. The rest of the
shell and settings-card padding is assumed to be about 150px; this was not measured, so step 4
measures it.

| Viewport | Sidebar | Container (est.) | Today |
|---|---|---|---|
| 1725 | expanded | ~1320 | Ignore hidden |
| 1725 | collapsed | ~1510 | ok |
| 1280 | collapsed | ~1066 | Ignore hidden; Target squeezed to ~310px |
| 1280 | expanded | ~874 | Ignore hidden; Target squeezed to ~118px |

## Approach

### 1. Engine: shrinkable columns (`minWidth`) in the DataTable fit

**Types**: `packages/types/src/interfaces/dataTable.interfaces.ts`, `BaseColumnDefinition`.
Add this field:

```ts
/**
 * Narrowest width (px or rem) the table may give this column when space is short.
 * Columns that declare one shrink toward it before any column is hidden.
 * It also replaces the default 96px floor for that column.
 */
minWidth?: string;
```

**Fit**: `packages/ui/src/components/dataTableColumnFit.ts`.

- `getColumnSizeConfig`: when `column.minWidth` parses (use `parseColumnWidth`, px/rem only,
  and ignore percent), set `minSize = min(parsedMin, size)`. Use it in place of the 96 floor
  when clamping the preferred size, so `width: '72px', minWidth: '72px'` gives 72. Compact and
  `title` columns keep their current branches unless they declare `minWidth`. Floor the parsed
  value at an absolute 40px so a typo cannot collapse a column.
- `computeColumnFit`: a column is shrinkable when `minSize < size` and it declared `minWidth`.
  - Admission: walk the same priority order. Count shrinkable columns at their `minSize` and
    fixed columns at their `size`. Admit while the total fits. The existing "shrink the first
    column that doesn't fit into `remaining` if `remaining >= minSize`, then stop" rule stays
    as it is for that column.
  - Distribution: if the admitted columns' preferred total is larger than `containerWidth`,
    shrink the admitted shrinkable columns by the deficit. Each column gives up space in
    proportion to its slack (`size - minSize`). Floor each share, add the rounding remainder to
    the last shrinkable column, and never go below `minSize`. Write the results to
    `sizeOverrides`. The admitted total must equal `containerWidth` exactly, so the table does
    not scroll.
  - **Backward compatible:** if no column declares `minWidth`, the shrinkable set is empty and
    the algorithm behaves exactly as it does today. Every existing table goes through that path,
    and the existing tests pin it.
- `DataTable.tsx` already passes `sizeOverrides` and `minSize` into TanStack (lines 595-608),
  so `DataTable.tsx` needs no change. Check that a user resize still clamps at the new
  `minSize`.
- Update the doc comment above `computeColumnFit` to describe the shrink step.

### 2. Grid: rebalance widths and declare flexible columns

In `AccountingMappingBulkGrid.tsx`, keep the column order and all ids/dataIndexes. Element ids
and test ids do not change.

| Column | width | minWidth | Notes |
|---|---|---|---|
| Save (`selected`) | 72px | 72px | Checkbox only. 72px leaves room for the "Save" header after cell padding (pl-4/px-3). |
| Service name (`name`) | 220px | 160px | Ellipsis already handled by DataTable cells. |
| Map To (`kindId`) | 200px | 140px | 200px shows "Xero Revenue Account" in full at wide widths. It is truncated today at 160. |
| Xero Target (`externalId`) | 520px | 240px | Takes most of the shrink, and of the stretch at wide widths, where `minWidth:100%` spreads extra space in proportion to width. |
| Ignore (`ignored`) | 72px | 72px | Checkbox only. |
| Status (`id`) | 140px | — | Fixed. It holds "Pending", "Saved", or "Ignored", or a wrapped error, and it already wraps (`!whitespace-normal [overflow-wrap:anywhere]`). |

The preferred total is 1224px and the minimum total is 824px. Every column stays visible down
to an 824px container, which covers every case in the card's visual check (the table above).
Below 824px the existing "Show all" banner takes over, and the header "Ignore all" still works.
Because the shrink is shared by slack (60/60/280), Target gives up 70% of it.
At an 874px container the deficit is 350px and the widths come out as 72/168/148/274/72/140,
which sums to 874. Target is still a usable searchable select and the badge still fits.

Replace the comment at lines 240-242. The new comment should say that widths are px
preferences, that `minWidth` marks the columns the table shrinks before hiding any, and that
the minimum total is 824px. To keep the numbers in one place and testable, hoist them into an
exported constant in the same file, for example
`export const BULK_GRID_COLUMN_SIZES = { select: { width: '72px', minWidth: '72px' }, … }`,
and spread it into each column definition.

### 3. Tests

- `server/src/test/unit/components/dataTableColumnFit.test.ts`: add tests for
  - shrinkable columns shrinking before any column is hidden, with the visible total equal to
    the container width
  - proportional-to-slack distribution, with the rounding remainder going to the last
    shrinkable column
  - no column going below its `minSize`, and hiding resuming once the minimum total overflows
  - `minWidth` lowering the 96px floor, with rem parsing and the 40px absolute floor
  - a regression check that the same column sets without `minWidth` produce the same output as
    before. The existing tests stay unchanged.
- New `server/src/test/unit/components/accountingMappingBulkGridColumnFit.test.ts`. Model it
  on `ticketActionsColumn.columnFit.test.tsx`: build columns from `BULK_GRID_COLUMN_SIZES` with
  the real Xero titles, run `computeColumnFit` at 824, 874, 1066, 1320 and 1510, and assert
  that `ignored` and `id` are visible and that `externalId` gets at least 240px. If the
  constant moves to its own module, import it from there.
- `AccountingMappingModuleView.bulk.test.tsx` should keep passing unchanged, because the
  ids are the same.

### 4. Visual check (Draft Implementation / smoke)

Use the dev server at `http://feature-bulk-mapping-grid-keep-the-ignore-column-visible.localhost:3535`.
Go to Settings → Integrations → Xero → service mappings → **Bulk map**. Check four cases:
1725px and 1280px viewports, each with the sidebar expanded and collapsed. For each case,
record the measured `.datatable-container` `clientWidth` (this replaces the estimates above).
Then confirm:

- there is no "column hidden" banner
- the per-row Ignore checkbox is visible and toggles
- the Status text and the Suggested/Possible match badges are readable and not clipped
- the Xero Target select fills its cell
- the Map To select is readable

Repeat the 1280 expanded case in dark theme, as the coding standards require. If the measured
1280-expanded container is under 824px, lower the Map To and Target minimums first. Map To can
go to 128 and Target to 220, giving a 792px minimum. Keep Save and Ignore at 72.

## Out of scope

- Merging Ignore into another column, or stacking Map To above Target. The engine change
  reaches every width the card asks for without making rows taller or changing what each
  control means.
- Changing which columns other DataTables hide. Nothing changes for any table that does not
  set `minWidth`.
- Clearing column widths that users saved in localStorage
  (`datatable-column-sizing:<module>-bulk-table`). PR #3634 has merged, so a user who resized
  a grid column keeps that width, because TanStack sizing state wins over the column default.
  That is the intended behavior for a manual resize, and it does not affect which columns fit.
