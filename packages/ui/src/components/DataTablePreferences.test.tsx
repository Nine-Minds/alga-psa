// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DataTable } from './DataTable';
import { DataTablePreferencesProvider } from './DataTablePreferences';

vi.mock('../lib/i18n/client', () => ({
  useTranslation: () => ({ t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? '' }),
}));
vi.mock('./CustomSelect', () => ({
  default: ({ id, value, options, onValueChange }: { id: string; value: string; options: Array<{ value: string; label: string }>; onValueChange: (value: string) => void }) => (
    <button id={id} role="combobox" onClick={() => onValueChange(options.find(option => option.value !== value)?.value ?? value)}>
      {options.find(option => option.value === value)?.label}
    </button>
  ),
}));

const rows = Array.from({ length: 60 }, (_, index) => ({ id: String(index), name: `Row ${index}` }));
const columns = [{ title: 'Name', dataIndex: 'name' }];

describe('DataTable page size preference', () => {
  it('applies a saved size and saves a newly selected size', async () => {
    const onSave = vi.fn();
    const view = render(<DataTablePreferencesProvider pageSizes={{ other: 50 }} hasLoaded={false} onPageSizesChange={onSave}>
      <DataTable id="stable" data={rows} columns={columns} />
    </DataTablePreferencesProvider>);
    expect(screen.getByRole('combobox').textContent).toContain('10 per page');
    view.rerender(<DataTablePreferencesProvider pageSizes={{ stable: 25, other: 50 }} hasLoaded onPageSizesChange={onSave}>
      <DataTable id="stable" data={rows} columns={columns} />
    </DataTablePreferencesProvider>);
    expect(screen.getByRole('combobox').textContent).toContain('25 per page');
    fireEvent.click(screen.getByRole('combobox'));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.any(Function)));
    const update = onSave.mock.calls[0][0] as (previous: Record<string, number>) => Record<string, number>;
    expect(update({ stable: 25, other: 50 })).toEqual({ stable: 10, other: 50 });
  });

  it('applies a saved size to an uncontrolled table after preferences load', async () => {
    const view = render(<DataTablePreferencesProvider pageSizes={{}} hasLoaded={false} onPageSizesChange={vi.fn()}>
      <DataTable id="uncontrolled" data={rows} columns={columns} />
    </DataTablePreferencesProvider>);
    view.rerender(<DataTablePreferencesProvider pageSizes={{ uncontrolled: 50 }} hasLoaded onPageSizesChange={vi.fn()}>
      <DataTable id="uncontrolled" data={rows} columns={columns} />
    </DataTablePreferencesProvider>);
    await waitFor(() => expect(screen.getByRole('combobox').textContent).toContain('50 per page'));
  });

  it('saves a user change for this table while preserving other table keys', () => {
    const onSave = vi.fn();
    render(<DataTablePreferencesProvider pageSizes={{ one: 25, two: 100 }} onPageSizesChange={onSave}>
      <DataTable id="one" data={rows} columns={columns} />
    </DataTablePreferencesProvider>);
    fireEvent.click(screen.getByRole('combobox'));
    const update = onSave.mock.calls[0][0] as (previous: Record<string, number>) => Record<string, number>;
    expect(update({ one: 25, two: 100 })).toEqual({ one: 10, two: 100 });
  });

  it('ignores an invalid saved size and falls back to the prop default', () => {
    render(<DataTablePreferencesProvider pageSizes={{ stable: 17 }} onPageSizesChange={vi.fn()}>
      <DataTable id="stable" data={rows} columns={columns} pageSize={25} />
    </DataTablePreferencesProvider>);
    expect(screen.getByRole('combobox').textContent).toContain('25 per page');
  });

  it('works without a provider', () => {
    const onItemsPerPageChange = vi.fn();
    render(<DataTable id="outside-provider" data={rows} columns={columns} onItemsPerPageChange={onItemsPerPageChange} />);
    expect(screen.getByRole('combobox').textContent).toContain('10 per page');
    expect(onItemsPerPageChange).not.toHaveBeenCalled();
  });

  it('does not persist a table without an id', () => {
    const onSave = vi.fn();
    render(<DataTablePreferencesProvider pageSizes={{ stable: 50 }} onPageSizesChange={onSave}>
      <DataTable data={rows} columns={columns} />
    </DataTablePreferencesProvider>);
    expect(screen.getByRole('combobox').textContent).toContain('10 per page');
    fireEvent.click(screen.getByRole('combobox'));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('resets a controlled server page when the page size changes', () => {
    const onItemsPerPageChange = vi.fn();
    const onPageChange = vi.fn();
    render(<DataTable id="server-table" data={rows.slice(0, 10)} columns={columns}
      currentPage={3} pageSize={10} totalItems={60} onItemsPerPageChange={onItemsPerPageChange} onPageChange={onPageChange} />);
    fireEvent.click(screen.getByRole('combobox'));
    expect(onItemsPerPageChange).toHaveBeenCalledWith(25);
    expect(onPageChange).toHaveBeenCalledWith(1);
  });

  it('does not add a pagination bar for ten or fewer rows', () => {
    const { container } = render(<DataTable id="small-table" data={rows.slice(0, 10)} columns={columns} />);
    expect(container.querySelector('[data-automation-id="small-table-pagination"]')).toBeNull();
  });

  it('does not read or write a table opted out of persistence', () => {
    const onItemsPerPageChange = vi.fn();
    const onSave = vi.fn();
    render(<DataTablePreferencesProvider pageSizes={{ legacy: 50 }} onPageSizesChange={onSave}>
      <DataTable id="legacy" persistPageSize={false} data={rows} columns={columns} pageSize={25} onItemsPerPageChange={onItemsPerPageChange} />
    </DataTablePreferencesProvider>);
    expect(screen.getByRole('combobox').textContent).toContain('25 per page');
    expect(onItemsPerPageChange).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('combobox').textContent).toContain('25 per page');
  });

  it('sends a saved size to a controlled table once after preferences load', async () => {
    const onItemsPerPageChange = vi.fn();
    render(<DataTablePreferencesProvider pageSizes={{ controlled: 50 }} onPageSizesChange={vi.fn()}>
      <DataTable id="controlled" data={rows} columns={columns} pageSize={10} onItemsPerPageChange={onItemsPerPageChange} />
    </DataTablePreferencesProvider>);
    await waitFor(() => expect(onItemsPerPageChange).toHaveBeenCalledTimes(1));
    expect(onItemsPerPageChange).toHaveBeenCalledWith(50);
  });

  it('syncs later uncontrolled pageSize prop changes', async () => {
    const view = render(<DataTable id="prop-sync" data={rows} columns={columns} pageSize={25} />);
    expect(screen.getByRole('combobox').textContent).toContain('25 per page');
    view.rerender(<DataTable id="prop-sync" data={rows} columns={columns} pageSize={50} />);
    await waitFor(() => expect(screen.getByRole('combobox').textContent).toContain('50 per page'));
  });
});
