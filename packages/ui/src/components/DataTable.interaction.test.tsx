// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DataTable } from './DataTable';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './DropdownMenu';
import type { ColumnDefinition } from '@alga-psa/types';

vi.mock('../lib/i18n/client', () => ({
  useTranslation: () => ({ t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? '' }),
}));

type User = { id: string; name: string };
const user = { id: 'admin', name: 'Administrator' };

function Actions({ name, onEdit }: { name: string; onEdit: () => void }) {
  return <DropdownMenu>
    <DropdownMenuTrigger aria-label={`Actions for ${name}`}>Open menu</DropdownMenuTrigger>
    <DropdownMenuContent>
      <DropdownMenuItem onSelect={onEdit}>Edit {name}</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>;
}

function columns(onEdit: () => void): ColumnDefinition<User>[] {
  return [
    { title: 'Name', dataIndex: 'name' },
    { title: 'Actions', dataIndex: 'id', render: (_value, row) => <Actions name={row.name} onEdit={onEdit} /> },
  ];
}

type Editable = { id: string; value: string };

function EditableTable() {
  const [value, setValue] = React.useState('');
  const cols: ColumnDefinition<Editable>[] = [
    {
      title: 'Target',
      dataIndex: 'value',
      render: (_v, row) => (
        <input
          id={`target-${row.id}`}
          aria-label="Target"
          value={row.value}
          onChange={(event) => setValue(event.target.value)}
        />
      ),
    },
  ];
  return <DataTable id="editable" data={[{ id: 'row-1', value }]} columns={cols} pagination={false} />;
}

describe('DataTable interactive cell continuity', () => {
  it('keeps the caret in a cell input when the cell gains its first text', () => {
    render(<EditableTable />);
    const input = screen.getByLabelText('Target');
    input.focus();

    // The cell's text goes from empty to "W" on this keystroke; the tooltip
    // wrapper used to appear with it and remount the field mid-word.
    fireEvent.change(input, { target: { value: 'W' } });
    expect(screen.getByLabelText('Target')).toBe(input);
    expect(document.activeElement).toBe(input);

    fireEvent.change(input, { target: { value: 'Web Hosting' } });
    expect((screen.getByLabelText('Target') as HTMLInputElement).value).toBe('Web Hosting');
    expect(document.activeElement).toBe(input);
  });

  it('keeps an open menu usable when refreshed column definitions and data arrive', async () => {
    const originalEdit = vi.fn(), refreshedEdit = vi.fn();
    const view = render(<DataTable id="users" data={[user]} columns={columns(originalEdit)} pagination={false} />);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Actions for Administrator' }), { key: 'ArrowDown' });
    await screen.findByRole('menuitem', { name: 'Edit Administrator' });

    // UserList rebuilds its column callbacks when asynchronously loaded avatars
    // arrive. The row identity is unchanged, so an open action must survive.
    view.rerender(<DataTable id="users" data={[{ ...user }]} columns={columns(refreshedEdit)} pagination={false} />);
    const edit = screen.getByRole('menuitem', { name: 'Edit Administrator' });
    fireEvent.click(edit);
    expect(refreshedEdit).toHaveBeenCalledTimes(1);
    expect(originalEdit).not.toHaveBeenCalled();
  });
});
