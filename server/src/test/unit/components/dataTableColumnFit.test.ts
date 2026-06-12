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
