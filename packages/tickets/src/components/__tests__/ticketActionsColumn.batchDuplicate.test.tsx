/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ITicketListItem } from '@alga-psa/types';
import { createTicketActionsColumn } from '../ticketActionsColumn';

// Render the menu inline: the radix menu needs pointer events jsdom does not provide.
vi.mock('@alga-psa/ui/components/DropdownMenu', () => ({
  DropdownMenu: ({ children }: any) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: any) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: any) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onClick, id }: any) => (
    <button id={id} type="button" onClick={onClick}>{children}</button>
  ),
}));

const record = { ticket_id: 'ticket-1' } as ITicketListItem;
const t = (_key: string, fallback: string) => fallback;

describe('ticket row actions: batch duplicate item', () => {
  it('calls onBatchDuplicate with the ticket id and does not trigger the row click', () => {
    const onBatchDuplicate = vi.fn();
    const onDuplicate = vi.fn();
    const onRowClick = vi.fn();
    const column = createTicketActionsColumn({ t, onDuplicate, onBatchDuplicate });
    render(<div onClick={onRowClick}>{column.render!(null, record, 0)}</div>);

    fireEvent.click(screen.getByText('Duplicate for contacts…'));
    expect(onBatchDuplicate).toHaveBeenCalledWith('ticket-1');
    expect(onDuplicate).not.toHaveBeenCalled();
    expect(onRowClick).not.toHaveBeenCalled();
    expect(document.getElementById('batch-duplicate-ticket-menu-item')).toBeInTheDocument();
  });

  it('keeps the single Duplicate item and omits the batch item when no handler is given', () => {
    const column = createTicketActionsColumn({ t, onDuplicate: vi.fn() });
    render(<div>{column.render!(null, record, 0)}</div>);
    expect(document.getElementById('duplicate-ticket-menu-item')).toBeInTheDocument();
    expect(document.getElementById('batch-duplicate-ticket-menu-item')).toBeNull();
  });
});
