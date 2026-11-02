// @vitest-environment jsdom
import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DataTable } from './DataTable';
import type { ColumnDefinition } from '@alga-psa/types';

vi.mock('../lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

type Row = { id: string; title: string };
const columns: ColumnDefinition<Row>[] = [{ title: 'Title', dataIndex: 'title' }];

function EmptyWindowFeed() {
  const [page, setPage] = useState(1);
  const data = page === 3 ? [{ id: 'later', title: 'Authorized result' }] : [];
  return <DataTable id="bounded-feed" data={data} columns={columns}
    totalItems={0} totalItemsExact={false} currentPage={page} pageSize={10}
    hasMorePages={page < 4} onPageChange={setPage} />;
}

describe('DataTable bounded empty windows', () => {
  it('continues across empty windows to later rows and keeps Previous on an empty terminal page', () => {
    render(<EmptyWindowFeed />);

    expect(screen.getByText(/Total count incomplete/)).toBeTruthy();
    fireEvent.click(document.getElementById('bounded-feed-pagination-next-btn')!);
    expect(screen.getByText(/Total count incomplete/)).toBeTruthy();
    fireEvent.click(document.getElementById('bounded-feed-pagination-next-btn')!);
    expect(screen.getByText('Authorized result')).toBeTruthy();

    fireEvent.click(document.getElementById('bounded-feed-pagination-next-btn')!);
    expect(screen.getByText(/Total count incomplete/)).toBeTruthy();
    const previous = document.getElementById('bounded-feed-pagination-prev-btn') as HTMLButtonElement;
    expect(previous.disabled).toBe(false);
    fireEvent.click(previous);
    expect(screen.getByText('Authorized result')).toBeTruthy();
  });
});
