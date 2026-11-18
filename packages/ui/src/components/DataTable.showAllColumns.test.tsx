// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataTable } from './DataTable';
import type { ColumnDefinition } from '@alga-psa/types';

vi.mock('../lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: string | { defaultValue?: string }) =>
      typeof options === 'string' ? options : options?.defaultValue ?? '',
  }),
}));

interface Row { id: string; a: string; b: string; c: string; d: string }
const ROWS: Row[] = [{ id: '1', a: 'a1', b: 'b1', c: 'c1', d: 'd1' }];
const COLUMNS: ColumnDefinition<Row>[] = ['a', 'b', 'c', 'd'].map((k) => ({
  title: k.toUpperCase(),
  dataIndex: k,
  width: '400px',
}));

const KEY = 'datatable-show-all-columns:t';
const headers = () => Array.from(document.querySelectorAll('thead th')).map((th) => th.textContent?.trim());

describe('DataTable "Show all" persistence', () => {
  beforeEach(() => {
    window.localStorage.clear();
    // Narrow container so not every column fits.
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(500);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  const ui = (props: Partial<React.ComponentProps<typeof DataTable>> = {}) => (
    <DataTable id="t" data={ROWS} columns={COLUMNS} pagination={false} {...(props as object)} />
  );

  it('starts fit-to-width when nothing is stored', () => {
    render(ui());
    expect(headers().length).toBeLessThan(4);
    expect(screen.getByText('Show all')).toBeTruthy();
  });

  it('keeps Show all across a remount and stores true', () => {
    const first = render(ui());
    fireEvent.click(screen.getByText('Show all'));
    expect(headers()).toEqual(['A', 'B', 'C', 'D']);
    expect(window.localStorage.getItem(KEY)).toBe('true');
    first.unmount();
    render(ui());
    expect(headers()).toEqual(['A', 'B', 'C', 'D']);
    expect(screen.getByText('Show less')).toBeTruthy();
  });

  it('Show less stores false and stays fit-to-width after a remount', () => {
    window.localStorage.setItem(KEY, 'true');
    const first = render(ui());
    fireEvent.click(screen.getByText('Show less'));
    expect(window.localStorage.getItem(KEY)).toBe('false');
    first.unmount();
    render(ui());
    expect(headers().length).toBeLessThan(4);
  });

  it('writes nothing without an id', () => {
    render(<DataTable data={ROWS} columns={COLUMNS} pagination={false} />);
    fireEvent.click(screen.getByText('Show all'));
    expect(headers()).toEqual(['A', 'B', 'C', 'D']);
    expect(window.localStorage.length).toBe(0);
  });

  it.each(['"yes"', '1', 'null', '{not json', '{"a":1}'])('treats stored %s as false', (raw) => {
    window.localStorage.setItem(KEY, raw);
    render(ui());
    expect(headers().length).toBeLessThan(4);
  });

  it('controlled prop wins and buttons call the callback', () => {
    const onChange = vi.fn();
    const { rerender } = render(ui({ showAllColumns: false, onShowAllColumnsChange: onChange }));
    fireEvent.click(screen.getByText('Show all'));
    expect(onChange).toHaveBeenCalledWith(true);
    expect(headers().length).toBeLessThan(4); // parent has not accepted the change
    rerender(ui({ showAllColumns: true, onShowAllColumnsChange: onChange }));
    expect(headers()).toEqual(['A', 'B', 'C', 'D']);
    fireEvent.click(screen.getByText('Show less'));
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it('survives data, sort and page props changing on a mounted table', () => {
    const props = { manualSorting: true, pagination: true, totalItems: 50, pageSize: 10 } as const;
    const { rerender } = render(ui({ ...props, currentPage: 1, sortBy: 'a', sortDirection: 'asc' }));
    fireEvent.click(screen.getByText('Show all'));
    const table = document.querySelector('table');
    rerender(ui({ ...props, currentPage: 2, pageSize: 25, sortBy: 'd', sortDirection: 'desc', data: [{ ...ROWS[0], id: '2' }] }));
    expect(document.querySelector('table')).toBe(table);
    // all columns still rendered, and the sort indicator moved to the sorted column
    expect(headers()).toEqual(['A', 'B', 'C', 'D↓']);
  });
});
