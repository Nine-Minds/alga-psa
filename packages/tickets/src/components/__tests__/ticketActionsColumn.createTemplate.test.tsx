/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createTicketActionsColumn } from '../ticketActionsColumn';

const t = (_key: string, fallback: any) => (typeof fallback === 'string' ? fallback : fallback?.defaultValue ?? _key);

function renderRowMenu(options: { canCreateTemplate?: boolean }, onCreateTemplate = vi.fn()) {
  const column = createTicketActionsColumn({
    t: t as any,
    onDuplicate: () => {},
    onCreateTemplate,
    ...options,
  } as any);
  const row = { ticket_id: 'ticket-1', ticket_number: 'TIC-1' } as any;
  const cell = (column as any).render(undefined, row, 0);
  render(<div>{cell}</div>);
  return onCreateTemplate;
}

describe('ticket row menu "Create template from ticket"', () => {
  afterEach(cleanup);

  it('shows the item (id create-template-ticket-menu-item) only with the permission, and stops propagation', async () => {
    const onCreateTemplate = renderRowMenu({ canCreateTemplate: true });
    await userEvent.click(document.getElementById('ticket-actions-menu-ticket-1') as HTMLElement);
    const item = await waitFor(() => {
      const el = document.getElementById('create-template-ticket-menu-item');
      if (!el) throw new Error('missing');
      return el;
    });
    await userEvent.click(item);
    expect(onCreateTemplate).toHaveBeenCalledWith('ticket-1');
  });

  it('omits the item without the permission', async () => {
    renderRowMenu({ canCreateTemplate: false });
    await userEvent.click(document.getElementById('ticket-actions-menu-ticket-1') as HTMLElement);
    await waitFor(() => expect(document.getElementById('duplicate-ticket-menu-item')).not.toBeNull());
    expect(document.getElementById('create-template-ticket-menu-item')).toBeNull();
  });
});
