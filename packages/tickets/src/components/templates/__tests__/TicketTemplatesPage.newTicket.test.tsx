/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const pushMock = vi.fn();
const listMock = vi.fn();
const templatePermsMock = vi.fn();
const checkPermsMock = vi.fn();

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock, replace: vi.fn() }) }));
vi.mock('react-hot-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@alga-psa/auth/actions', () => ({
  checkCurrentUserPermissions: (...args: unknown[]) => checkPermsMock(...args),
}));
vi.mock('../../../actions/ticketTemplateActions', () => ({
  listTicketTemplates: (...args: unknown[]) => listMock(...args),
  deleteTicketTemplate: vi.fn(),
  setTicketTemplateActive: vi.fn(),
}));
vi.mock('../useTicketTemplatePermissions', () => ({
  useTicketTemplatePermissions: () => templatePermsMock(),
}));
// The real DataTable and dropdown are covered elsewhere; here rows and menu items render inline so the
// test can see which actions a row offers and click them.
vi.mock('@alga-psa/ui/components/DataTable', () => ({
  DataTable: ({ id, data, columns }: any) => (
    <div id={id}>
      {data.map((row: any) => (
        <div key={row.template_id} data-testid={`row-${row.template_id}`}>
          {columns.map((col: any) => (
            <div key={String(col.dataIndex)}>{col.render ? col.render(row[col.dataIndex], row) : String(row[col.dataIndex] ?? '')}</div>
          ))}
        </div>
      ))}
    </div>
  ),
}));
vi.mock('@alga-psa/ui/components/DropdownMenu', () => ({
  DropdownMenu: ({ children }: any) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: any) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: any) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onClick, id }: any) => (
    <button type="button" id={id} onClick={(event) => onClick?.(event)}>{children}</button>
  ),
}));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: any) => (typeof fallback === 'string' ? fallback : fallback?.defaultValue ?? _key),
  }),
}));

import { TicketTemplatesPage } from '../TicketTemplatesPage';

const ACTIVE = '00000000-0000-4000-8000-000000000001';
const INACTIVE = '00000000-0000-4000-8000-000000000002';

const item = (template_id: string, is_active: boolean) => ({
  template_id,
  name: `Template ${template_id.slice(-1)}`,
  title: 'Department change',
  board_name: 'Service',
  checklist_count: 3,
  is_active,
  // The list item now carries R5 (offered for manual use) and the schedule count.
  offer_for_manual_use: true,
  schedule_count: 0,
});

const perms = (overrides: Partial<Record<'read' | 'create' | 'update' | 'delete', boolean>> = {}) => ({
  read: true, create: false, update: false, delete: false, loaded: true, ...overrides,
});

const grantTicketCreate = (granted: boolean) =>
  checkPermsMock.mockImplementation(async (checks: Array<{ resource: string; action: string }>) =>
    checks.map((check) => ({ ...check, granted })));

const newTicketItem = (row: string) =>
  screen.getByTestId(`row-${row}`).querySelector('#new-ticket-from-template-menu-item');

describe('TicketTemplatesPage: New ticket from template', () => {
  beforeEach(() => {
    pushMock.mockReset();
    checkPermsMock.mockReset();
    listMock.mockReset().mockResolvedValue([item(ACTIVE, true), item(INACTIVE, false)]);
    templatePermsMock.mockReset().mockReturnValue(perms());
  });

  it('a technician with ticket:create (no template admin grants) gets the action and it opens Quick Add from the template', async () => {
    grantTicketCreate(true);
    render(<TicketTemplatesPage />);

    await waitFor(() => expect(newTicketItem(ACTIVE)).not.toBeNull());
    expect(checkPermsMock).toHaveBeenCalledWith([{ resource: 'ticket', action: 'create' }]);
    // Edit/Delete stay admin-only.
    expect(document.querySelector('#edit-ticket-template-menu-item')).toBeNull();
    expect(document.querySelector('#delete-ticket-template-menu-item')).toBeNull();

    newTicketItem(ACTIVE)!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(pushMock).toHaveBeenCalledWith(`/msp/create-ticket?template=${ACTIVE}`);
  });

  it('is not offered on inactive templates, which addTicket refuses', async () => {
    grantTicketCreate(true);
    render(<TicketTemplatesPage />);

    await waitFor(() => expect(newTicketItem(ACTIVE)).not.toBeNull());
    expect(newTicketItem(INACTIVE)).toBeNull();
  });

  it('carries the AlgaDesk form flag so the AlgaDesk Quick Add opens', async () => {
    grantTicketCreate(true);
    render(<TicketTemplatesPage isAlgaDeskMode />);

    await waitFor(() => expect(newTicketItem(ACTIVE)).not.toBeNull());
    newTicketItem(ACTIVE)!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(pushMock).toHaveBeenCalledWith(`/msp/create-ticket?template=${ACTIVE}&form=algadesk`);
  });

  it('is hidden without ticket:create, even for a template admin', async () => {
    grantTicketCreate(false);
    templatePermsMock.mockReturnValue(perms({ create: true, update: true, delete: true }));
    render(<TicketTemplatesPage />);

    await waitFor(() => expect(screen.getByTestId(`row-${ACTIVE}`)).toBeInTheDocument());
    await waitFor(() => expect(checkPermsMock).toHaveBeenCalled());
    expect(newTicketItem(ACTIVE)).toBeNull();
    expect(screen.getByTestId(`row-${ACTIVE}`).querySelector('#edit-ticket-template-menu-item')).not.toBeNull();
  });
});
