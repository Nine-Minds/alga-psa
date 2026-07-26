// @vitest-environment jsdom
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DataTable } from './DataTable';
import type { ColumnDefinition } from '@alga-psa/types';

vi.mock('../lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? '',
  }),
}));

interface Client {
  id: string;
  name: string;
  users: number;
}

const CLIENTS: Client[] = [
  { id: 'a', name: 'Emerald City', users: 42 },
  { id: 'b', name: 'Northwind Traders', users: 18 },
];

const COLUMNS: ColumnDefinition<Client>[] = [
  { title: 'Client', dataIndex: 'name' },
  { title: 'Users', dataIndex: 'users' },
];

const bodyRows = () => Array.from(document.querySelectorAll('tbody tr'));

describe('DataTable expandedRowRender', () => {
  it('renders nothing extra when no expansion is asked for', () => {
    render(<DataTable id="t" data={CLIENTS} columns={COLUMNS} pagination={false} />);

    expect(bodyRows()).toHaveLength(2);
  });

  it('puts the detail in a full-width row under the record it belongs to', () => {
    render(
      <DataTable
        id="t"
        data={CLIENTS}
        columns={COLUMNS}
        pagination={false}
        expandedRowRender={(client) =>
          client.id === 'a' ? <p>Create 12 · Link 30</p> : null
        }
      />
    );

    const rows = bodyRows();
    // Two records, one of them expanded — the detail follows its own row rather
    // than being appended at the end of the table.
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain('Emerald City');
    expect(rows[1].textContent).toContain('Create 12');
    expect(rows[2].textContent).toContain('Northwind Traders');

    // Full width, so the detail is not squeezed into the first column.
    const detailCell = rows[1].querySelector('td');
    expect(detailCell?.getAttribute('colspan')).toBe(String(COLUMNS.length));
  });

  it('passes the record and its index to the renderer', () => {
    const renderDetail = vi.fn().mockReturnValue(null);
    render(
      <DataTable
        id="t"
        data={CLIENTS}
        columns={COLUMNS}
        pagination={false}
        expandedRowRender={renderDetail}
      />
    );

    expect(renderDetail).toHaveBeenCalledWith(CLIENTS[0], 0);
    expect(renderDetail).toHaveBeenCalledWith(CLIENTS[1], 1);
  });

  it('does not fire onRowClick when the detail is clicked', async () => {
    const onRowClick = vi.fn();
    render(
      <DataTable
        id="t"
        data={CLIENTS}
        columns={COLUMNS}
        pagination={false}
        onRowClick={onRowClick}
        expandedRowRender={(client) =>
          client.id === 'a' ? <button type="button">Retry</button> : null
        }
      />
    );

    // The detail is its own row, so interacting with it must not read as
    // selecting the record above.
    screen.getByRole('button', { name: 'Retry' }).click();
    expect(onRowClick).not.toHaveBeenCalled();
  });
});
