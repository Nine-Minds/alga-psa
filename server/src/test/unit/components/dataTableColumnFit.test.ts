import { describe, it, expect } from 'vitest';
import {
  computeColumnFit,
  getColumnLayout,
  getColumnSizeConfig,
} from '@alga-psa/ui/components/dataTableColumnFit';
import type { ColumnDefinition } from '@alga-psa/types';

const col = (
  dataIndex: string,
  width?: string,
  title: string = dataIndex,
  render?: ColumnDefinition<any>['render']
): ColumnDefinition<any> => ({ title, dataIndex, width, render });

const fit = (columns: ColumnDefinition<any>[], containerWidth: number) =>
  computeColumnFit(columns, containerWidth, getColumnLayout(columns, containerWidth));

const sizeOf = (column: ColumnDefinition<any>, columns: ColumnDefinition<any>[], containerWidth: number) =>
  getColumnSizeConfig(column, getColumnLayout(columns, containerWidth)).size;

// Mirrors the client contacts tab: percent widths summing slightly over 100%.
const contactsColumns = [
  col('full_name', '40%', 'Name'),
  col('email', '30%', 'Email'),
  col('default_phone_number', '30%', 'Phone Number'),
  col('actions', '5%', 'Actions', () => null),
];

// Mirrors the tickets table: many columns with small percentages.
const ticketsColumns = [
  col('selection', '4%', ''),
  col('ticket_number', '7%', 'Ticket Number'),
  col('title', '16%', 'Title'),
  col('status_name', '8%', 'Status'),
  col('priority_name', '7%', 'Priority'),
  col('sla_policy_id', '5%', 'SLA'),
  col('board_name', '7%', 'Board'),
  col('category_name', '7%', 'Category'),
  col('client_name', '9%', 'Client'),
  col('assigned_to_name', '8%', 'Assigned To'),
  col('due_date', '9%', 'Due Date'),
  col('entered_at', '10%', 'Created'),
  col('entered_by_name', '6%', 'Created By'),
  col('tags', '8%', 'Tags'),
];

describe('computeColumnFit', () => {
  it('shows every column of a ~100%-sum percent table at common container widths', () => {
    for (const width of [900, 1100, 1300, 1600, 1900]) {
      const { visibleColumnIds } = fit(contactsColumns, width);
      expect(visibleColumnIds, `container ${width}px`).toEqual([
        'full_name',
        'email',
        'default_phone_number',
        'actions',
      ]);
    }
  });

  it('preserves the original column order in the visible list', () => {
    const { visibleColumnIds } = fit(contactsColumns, 1300);
    expect(visibleColumnIds).toEqual(contactsColumns.map(c => c.dataIndex));
  });

  it('hides columns instead of squeezing a many-column table below readable widths', () => {
    const { visibleColumnIds } = fit(ticketsColumns, 1600);
    // The banner condition: some columns must be hidden so "show all" + scroll is offered.
    expect(visibleColumnIds.length).toBeLessThan(ticketsColumns.length);
    expect(visibleColumnIds.length).toBeGreaterThan(4);
  });

  it('keeps a localized actions column visible when it is the last column', () => {
    // German UI: the title is "Aktionen", so detection must work via dataIndex.
    const columns = [
      col('name', '40%', 'Name'),
      col('email', '40%', 'E-Mail'),
      col('phone', '40%', 'Telefonnummer'),
      col('notes', '40%', 'Notizen'),
      col('actions', '5%', 'Aktionen', () => null),
    ];
    const { visibleColumnIds } = fit(columns, 600);
    expect(visibleColumnIds).toContain('actions');
    expect(visibleColumnIds.length).toBeLessThan(columns.length);
  });

  it('shrinks the next column into leftover space instead of hiding it', () => {
    const columns = [
      col('a', '300px'),
      col('b', '300px'),
      col('c', '180px'),
    ];
    const { visibleColumnIds, sizeOverrides } = fit(columns, 700);
    // c does not fit at 180px (300+300+180 > 700) but fits at its 96px minimum.
    expect(visibleColumnIds).toEqual(['a', 'b', 'c']);
    expect(sizeOverrides).toEqual({ c: 100 });
  });

  it('hides the next column when even its minimum width does not fit', () => {
    const columns = [
      col('a', '320px'),
      col('b', '320px'),
      col('c', '180px'),
    ];
    const { visibleColumnIds, sizeOverrides } = fit(columns, 700);
    // Remaining space is 60px, below the 96px regular-column minimum.
    expect(visibleColumnIds).toEqual(['a', 'b']);
    expect(sizeOverrides).toEqual({});
  });

  it('always includes the first prioritized column even if it overflows alone', () => {
    const { visibleColumnIds } = fit([col('a', '600px'), col('b', '600px')], 400);
    expect(visibleColumnIds).toEqual(['a']);
  });
});

describe('getColumnSizeConfig', () => {
  it('resolves percent widths against the container, not a fixed design width', () => {
    const columns = [col('half', '50%'), col('rest', '50%')];
    expect(sizeOf(columns[0], columns, 1000)).toBeLessThanOrEqual(500);
    expect(sizeOf(columns[0], columns, 1000)).toBeGreaterThan(400);
  });

  it('normalizes percent widths when they sum to more than 100%', () => {
    const columns = [col('a', '100%'), col('b', '100%')];
    const a = sizeOf(columns[0], columns, 800);
    const b = sizeOf(columns[1], columns, 800);
    expect(a + b).toBeLessThanOrEqual(800);
    expect(a).toBe(b);
  });

  it('never squeezes a percent-width column below its natural width', () => {
    const columns = ticketsColumns;
    // 6% of ~1600px is ~95px; the natural width for "Created By" is larger.
    const createdBy = columns.find(c => c.dataIndex === 'entered_by_name')!;
    expect(sizeOf(createdBy, columns, 1600)).toBeGreaterThanOrEqual(160);
  });

  it('reads a rem width as rem, not as that many pixels', () => {
    // '18rem' used to fall through to the bare-number branch and resolve to 18
    // pixels, so the column collapsed to its minimum with nothing to say why.
    const columns = [col('wide', '18rem'), col('rest', '50%')];
    expect(sizeOf(columns[0], columns, 1000)).toBe(288);
  });

  it('honors explicit pixel widths without applying the natural floor', () => {
    const columns = [col('narrow', '120px', 'Some Long Column Title')];
    expect(sizeOf(columns[0], columns, 1600)).toBe(120);
  });

  it.each(['selection', 'checkbox', 'select'])(
    'pins the %s column to checkbox width regardless of declared percentage',
    (id) => {
      const columns = [col(id, '5%', ''), col('name', '95%', 'Name')];
      expect(sizeOf(columns[0], columns, 1900)).toBeLessThanOrEqual(56);
      expect(sizeOf(columns[0], columns, 1900)).toBeGreaterThanOrEqual(44);
    }
  );

  it('caps compact columns like tags at their maximum', () => {
    const columns = [col('tags', '30%', ''), col('name', '70%', 'Name')];
    expect(sizeOf(columns[0], columns, 1900)).toBeLessThanOrEqual(180);
  });
});

describe('computeColumnFit shrinkable columns (minWidth)', () => {
  const shrinkCol = (dataIndex: string, width: string, minWidth?: string): ColumnDefinition<any> => ({
    title: dataIndex,
    dataIndex,
    width,
    minWidth,
  });
  const total = (columns: ColumnDefinition<any>[], result: ReturnType<typeof fit>) =>
    columns
      .filter(c => result.visibleColumnIds.includes(c.dataIndex as string))
      .reduce((sum, c) => sum + (result.sizeOverrides[c.dataIndex as string]
        ?? getColumnSizeConfig(c).size), 0);

  it('shrinks columns before hiding any and fills the container exactly', () => {
    const columns = [shrinkCol('a', '300px', '100px'), shrinkCol('b', '300px', '100px'), shrinkCol('c', '200px')];
    const result = fit(columns, 600);
    expect(result.visibleColumnIds).toEqual(['a', 'b', 'c']);
    expect(total(columns, result)).toBe(600);
  });

  it('shares the deficit in proportion to slack, remainder to the last shrinkable column', () => {
    // slack a=200, b=100 (total 300); deficit 100 => a cut floor(66.67)=66, b cut 33, remainder 1 -> b
    const columns = [shrinkCol('a', '300px', '100px'), shrinkCol('b', '200px', '100px'), shrinkCol('c', '200px')];
    const result = fit(columns, 600);
    expect(result.sizeOverrides).toEqual({ a: 234, b: 166 });
    expect(total(columns, result)).toBe(600);
  });

  it('never goes below minSize and resumes hiding once the minimum total overflows', () => {
    const columns = [shrinkCol('a', '300px', '100px'), shrinkCol('b', '300px', '100px'), shrinkCol('c', '200px')];
    const atMin = fit(columns, 400);
    expect(atMin.visibleColumnIds).toEqual(['a', 'b', 'c']);
    expect(atMin.sizeOverrides).toEqual({ a: 100, b: 100 });
    // 350: a and b sit at their minimum and the fixed column takes the leftover (existing rule).
    expect(fit(columns, 350).sizeOverrides).toEqual({ a: 100, b: 100, c: 150 });
    // 250: even the minimum total (400) overflows and the leftover (50) is under c's floor.
    const tooNarrow = fit(columns, 250);
    expect(tooNarrow.visibleColumnIds).toEqual(['a', 'b']);
    for (const [id, size] of Object.entries(tooNarrow.sizeOverrides)) {
      const column = columns.find(c => c.dataIndex === id)!;
      expect(size).toBeGreaterThanOrEqual(getColumnSizeConfig(column).minSize);
    }
  });

  it('leaves columns at their preferred size when everything fits', () => {
    const columns = [shrinkCol('a', '300px', '100px'), shrinkCol('b', '200px')];
    expect(fit(columns, 800)).toEqual({ visibleColumnIds: ['a', 'b'], sizeOverrides: {} });
  });

  it('lowers the 96px floor, parses rem, and holds the 40px absolute floor', () => {
    const columns = [shrinkCol('a', '72px', '72px'), shrinkCol('b', '200px', '5rem'), shrinkCol('c', '200px', '10px')];
    expect(getColumnSizeConfig(columns[0])).toMatchObject({ size: 72, minSize: 72 });
    expect(getColumnSizeConfig(columns[1])).toMatchObject({ size: 200, minSize: 80 });
    expect(getColumnSizeConfig(columns[2])).toMatchObject({ size: 200, minSize: 40 });
  });

  it('ignores percent minWidth and keeps minSize <= size', () => {
    expect(getColumnSizeConfig(shrinkCol('a', '200px', '50%')).minSize).toBe(96);
    // minWidth replaces the floor used to clamp the preferred size, so size is raised to it.
    expect(getColumnSizeConfig(shrinkCol('a', '100px', '150px'))).toMatchObject({ size: 150, minSize: 150 });
  });

  it('produces the same output as before for column sets without minWidth', () => {
    // Reference: the original greedy fit (no shrink step), reusing the exported size config.
    const legacy = (columns: ColumnDefinition<any>[], width: number) => {
      const layout = getColumnLayout(columns, width);
      const order = [...columns].sort((a, b) => {
        const aId = a.dataIndex === 'id';
        const bId = b.dataIndex === 'id';
        if (aId && !bId) return -1;
        if (!aId && bId) return 1;
        if (a.width && !b.width) return -1;
        if (!a.width && b.width) return 1;
        return 0;
      });
      const visible = new Set<string>();
      const overrides: Record<string, number> = {};
      let used = 0;
      for (const c of order) {
        const { size, minSize } = getColumnSizeConfig(c, layout);
        const id = c.dataIndex as string;
        if (visible.size > 0 && used + size > width) {
          const remaining = width - used;
          if (remaining >= minSize) {
            overrides[id] = remaining;
            visible.add(id);
          }
          break;
        }
        used += size;
        visible.add(id);
      }
      return { visibleColumnIds: columns.map(c => c.dataIndex as string).filter(id => visible.has(id)), sizeOverrides: overrides };
    };
    const sets = [
      [col('id', '280px'), col('a', '96px'), col('b', '220px'), col('c', '160px'), col('d', '520px'), col('e', '96px')],
      [col('x', '40%', 'Name'), col('y', '30%', 'Email'), col('z'), col('w', '200px')],
      [col('title', '30%'), col('select', '5%', ''), col('p'), col('q', '18rem')],
    ];
    for (const columns of sets) {
      for (const width of [300, 500, 824, 1000, 1372, 1600, 2000]) {
        expect(fit(columns, width)).toEqual(legacy(columns, width));
      }
    }
  });
});
