// @vitest-environment jsdom
import React from 'react';
import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataTable } from './DataTable';
import type { ColumnDefinition } from '@alga-psa/types';

vi.mock('../lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? '',
  }),
}));

interface Row {
  id: string;
  name: string;
}

const ROWS: Row[] = [{ id: 'a', name: 'Emerald City' }];

describe('DataTable duplicate column ids', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it('warns once, naming the duplicated id, when two columns share a dataIndex', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const columns: ColumnDefinition<Row>[] = [
      { title: 'Name', dataIndex: 'name' },
      { title: 'Again', dataIndex: 'id' },
      { title: 'Other', dataIndex: 'id' },
    ];
    const { rerender } = render(<DataTable id="dup" data={ROWS} columns={columns} pagination={false} />);
    rerender(<DataTable id="dup" data={ROWS} columns={columns} pagination={false} />);
    const calls = warn.mock.calls.filter((args) => String(args[0]).includes('share the same column id'));
    expect(calls).toHaveLength(1);
    expect(String(calls[0][0])).toContain('"id"');
  });

  it('does not warn when column ids are unique', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(<DataTable id="uniq" data={ROWS} columns={[{ title: 'Name', dataIndex: 'name' }, { title: 'Id', dataIndex: 'id' }]} pagination={false} />);
    expect(warn.mock.calls.filter((args) => String(args[0]).includes('share the same column id'))).toHaveLength(0);
  });
});
