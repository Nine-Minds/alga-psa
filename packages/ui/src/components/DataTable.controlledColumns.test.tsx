// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataTable } from './DataTable';
import { applyColumnVisibilityAndOrder } from './dataTableColumnState';
import type { ColumnDefinition } from '@alga-psa/types';

vi.mock('../lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? '',
  }),
}));

interface Row {
  id: string;
  name: string;
  owner: string;
  users: number;
}

const ROWS: Row[] = [
  { id: 'a', name: 'Emerald City', owner: 'Dana', users: 42 },
  { id: 'b', name: 'Northwind Traders', owner: 'Ari', users: 18 },
];

const COLUMNS: ColumnDefinition<Row>[] = [
  { title: 'Client', dataIndex: 'name' },
  { title: 'Owner', dataIndex: 'owner' },
  { title: 'Users', dataIndex: 'users' },
];

const headerTexts = () => Array.from(document.querySelectorAll('thead th')).map((th) => th.textContent?.trim());
const headerWidth = (title: string) => {
  const th = Array.from(document.querySelectorAll<HTMLElement>('thead th')).find((el) => el.textContent?.includes(title));
  return th?.style.width;
};

describe('DataTable controlled columns', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    window.localStorage.clear();
  });

  it('hides columns the caller marks invisible and keeps the rest', () => {
    render(<DataTable id="t" data={ROWS} columns={COLUMNS} pagination={false} columnVisibility={{ owner: false, users: true }} />);
    expect(headerTexts()).toEqual(['Client', 'Users']);
  });

  it('orders columns sparsely: listed first, then the rest in definition order', () => {
    render(<DataTable id="t" data={ROWS} columns={COLUMNS} pagination={false} columnOrder={['users']} />);
    expect(headerTexts()).toEqual(['Users', 'Client', 'Owner']);
  });

  it('renders controlled widths and ignores remembered ones while controlled', () => {
    window.localStorage.setItem('datatable-column-sizing:t', JSON.stringify({ name: 111 }));
    render(<DataTable id="t" data={ROWS} columns={COLUMNS} pagination={false} columnSizing={{ name: 333 }} />);
    expect(headerWidth('Client')).toBe('333px');
  });

  it('falls back to the widths remembered in localStorage when uncontrolled', () => {
    window.localStorage.setItem('datatable-column-sizing:t', JSON.stringify({ name: 222 }));
    render(<DataTable id="t" data={ROWS} columns={COLUMNS} pagination={false} />);
    expect(headerWidth('Client')).toBe('222px');
  });

  it('reports client-side sort changes without taking the sort over', () => {
    const onSortChange = vi.fn();
    render(<DataTable id="t" data={ROWS} columns={COLUMNS} pagination={false} onSortChange={onSortChange} />);
    const clientHeader = Array.from(document.querySelectorAll<HTMLElement>('thead th')).find((el) => el.textContent?.includes('Client'))!;
    fireEvent.click(clientHeader);
    expect(onSortChange).toHaveBeenCalledWith('name', expect.stringMatching(/^(asc|desc)$/));
  });
});

describe('applyColumnVisibilityAndOrder', () => {
  it('returns the same array when neither control is given', () => {
    expect(applyColumnVisibilityAndOrder(COLUMNS, undefined, undefined)).toBe(COLUMNS);
  });

  it('ignores unknown ids in order and visibility', () => {
    const result = applyColumnVisibilityAndOrder(COLUMNS, { retired: false }, ['retired', 'owner']);
    expect(result.map((column) => column.dataIndex)).toEqual(['owner', 'name', 'users']);
  });
});
