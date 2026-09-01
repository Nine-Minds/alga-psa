// @vitest-environment jsdom
import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getInteractionsPage: vi.fn(),
  getAllInteractionTypes: vi.fn(),
  getInteractionStatuses: vi.fn(),
  getUserAvatarUrlsBatchAction: vi.fn(),
  openDrawer: vi.fn(),
  openClientDrawer: vi.fn(),
  openContactDrawer: vi.fn(),
  tableProps: null as Record<string, any> | null,
}));

vi.mock('@alga-psa/clients/actions', () => ({
  getInteractionsPage: mocks.getInteractionsPage,
  getAllInteractionTypes: mocks.getAllInteractionTypes,
  getInteractionStatuses: mocks.getInteractionStatuses,
}));

vi.mock('@alga-psa/ui', () => ({
  useDrawer: () => ({ openDrawer: mocks.openDrawer }),
  useClientDrawer: () => ({ openClientDrawer: mocks.openClientDrawer }),
}));
vi.mock('@alga-psa/user-composition/actions', () => ({
  getUserAvatarUrlsBatchAction: mocks.getUserAvatarUrlsBatchAction,
}));
vi.mock('@alga-psa/ui/lib/i18n/client', () => {
  const t = (key: string, options?: Record<string, unknown> & { defaultValue?: string }) => {
    let value = options?.defaultValue ?? key;
    for (const [name, replacement] of Object.entries(options ?? {})) {
      value = value.replace(`{{${name}}}`, String(replacement));
    }
    return value;
  };
  return { useTranslation: () => ({ t }) };
});
vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
}));
vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: ({ containerClassName: _containerClassName, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { containerClassName?: string }) => <input {...props} />,
}));
vi.mock('@alga-psa/ui/components/DataTable', () => ({
  DataTable: (props: Record<string, any>) => {
    mocks.tableProps = props;
    return (
      <div data-testid="interaction-data-table">
        <span>{props.data.length} rows</span>
        <button onClick={() => props.onPageChange(2)}>Page 2</button>
      </div>
    );
  },
}));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({ id }: { id?: string }) => <div id={id} />,
}));
vi.mock('@alga-psa/ui/components/ClientPicker', () => ({ ClientPicker: () => <div /> }));
vi.mock('@alga-psa/ui/components/ContactPicker', () => ({ ContactPicker: () => <div /> }));
vi.mock('@alga-psa/ui/components/DateTimePicker', () => ({ DateTimePicker: ({ id }: { id?: string }) => <div id={id} /> }));
vi.mock('@alga-psa/ui/components/InteractionIcon', () => ({ default: () => <span /> }));
vi.mock('@alga-psa/ui/components/UserPicker', () => ({ default: () => <div /> }));
vi.mock('@alga-psa/ui/components/ClientAvatar', () => ({ default: () => <span data-testid="client-avatar" /> }));
vi.mock('@alga-psa/ui/components/ContactAvatar', () => ({ default: () => <span data-testid="contact-avatar" /> }));
vi.mock('@alga-psa/ui/components/UserAvatar', () => ({ default: () => <span data-testid="user-avatar" /> }));
vi.mock('./InteractionDetails', () => ({ default: () => <div /> }));
vi.mock('./QuickAddInteraction', () => ({
  QuickAddInteraction: ({ isOpen }: { isOpen: boolean }) => isOpen
    ? <div data-testid="quick-add-interaction" />
    : null,
}));
vi.mock('../clients/ClientQuickView', () => ({ default: () => <div /> }));
vi.mock('../contacts/QuickAddContact', () => ({ default: () => null }));
vi.mock('../contacts/bento/useContactQuickViewDrawer', () => ({
  useContactQuickViewDrawer: () => mocks.openContactDrawer,
}));

import OverallInteractionsFeed from './OverallInteractionsFeed';

const interaction = {
  interaction_id: 'interaction-1',
  type_id: 'type-1',
  type_name: 'note',
  contact_name_id: 'contact-1',
  contact_name: 'Dorothy Gale',
  client_id: 'client-1',
  client_name: 'Emerald City',
  user_id: 'user-1',
  user_name: 'Agent',
  ticket_id: null,
  title: 'Follow up',
  interaction_date: new Date('2026-08-25T12:00:00.000Z'),
  duration: null,
  tenant: 'tenant-1',
  status_id: 'status-1',
  status_name: 'In Progress',
  is_status_closed: false,
};

const users = [{
  user_id: 'user-1',
  username: 'agent',
  first_name: 'Dorothy',
  last_name: 'Agent',
  email: 'dorothy@example.com',
  is_inactive: false,
  tenant: 'tenant-1',
  user_type: 'internal' as const,
}];

const contacts = [{
  contact_name_id: 'contact-1',
  full_name: 'Dorothy Gale',
  client_id: 'client-1',
  phone_numbers: [],
  email: 'dorothy@example.com',
  role: null,
  notes: null,
  is_inactive: false,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  tenant: 'tenant-1',
  avatarUrl: '/contact-avatar.png',
}];

const clients = [{
  client_id: 'client-1',
  client_name: 'Emerald City',
  url: '',
  is_inactive: false,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  billing_cycle: 'monthly' as const,
  is_tax_exempt: false,
  tenant: 'tenant-1',
  logoUrl: '/client-logo.png',
}];

describe('OverallInteractionsFeed table', () => {
  beforeEach(() => {
    mocks.tableProps = null;
    mocks.getInteractionsPage.mockReset().mockResolvedValue({
      interactions: [interaction],
      total: 42,
      page: 1,
      pageSize: 10,
    });
    mocks.getAllInteractionTypes.mockReset().mockResolvedValue([]);
    mocks.getInteractionStatuses.mockReset().mockResolvedValue([]);
    mocks.getUserAvatarUrlsBatchAction.mockReset().mockResolvedValue(new Map([
      ['user-1', '/user-avatar.png'],
    ]));
    mocks.openDrawer.mockReset();
    mocks.openClientDrawer.mockReset();
    mocks.openContactDrawer.mockReset().mockResolvedValue(undefined);
  });

  afterEach(cleanup);

  it('uses DataTable pagination and resets to page one for debounced search', async () => {
    render(<OverallInteractionsFeed users={[]} contacts={[]} clients={[]} />);

    expect(await screen.findByTestId('interaction-data-table')).toBeTruthy();
    expect(mocks.getInteractionsPage).toHaveBeenCalledWith(expect.objectContaining({
      page: 1,
      pageSize: 10,
    }));
    expect(mocks.tableProps).toMatchObject({
      pagination: true,
      currentPage: 1,
      pageSize: 10,
      totalItems: 42,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Page 2' }));
    await waitFor(() => expect(mocks.getInteractionsPage).toHaveBeenCalledWith(
      expect.objectContaining({ page: 2, pageSize: 10 }),
    ));

    fireEvent.change(screen.getByPlaceholderText('Search interactions'), {
      target: { value: 'urgent' },
    });
    await new Promise((resolve) => setTimeout(resolve, 350));
    await waitFor(() => expect(mocks.getInteractionsPage).toHaveBeenCalledWith(
      expect.objectContaining({ search: 'urgent', page: 1, pageSize: 10 }),
    ));
  });

  it('keeps advanced filters collapsed until the standard Filters control is opened', async () => {
    render(<OverallInteractionsFeed users={[]} contacts={[]} clients={[]} />);
    await screen.findByTestId('interaction-data-table');

    expect(document.getElementById('overall-interactions-expanded-filters')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    const expandedFilters = document.getElementById('overall-interactions-expanded-filters');
    expect(expandedFilters).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reset' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reset' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Reset' }).parentElement?.className).not.toContain('col-span');
  });

  it('restores the Add Interaction action and opens the standalone quick-add dialog', async () => {
    render(<OverallInteractionsFeed users={[]} contacts={[]} clients={[]} />);
    await screen.findByTestId('interaction-data-table');

    fireEvent.click(screen.getByRole('button', { name: 'Add Interaction' }));

    expect(screen.getByTestId('quick-add-interaction')).toBeTruthy();
  });

  it('renders avatar links for related entities and opens each details drawer', async () => {
    const openUser = vi.fn();
    render(
      <OverallInteractionsFeed
        users={users}
        contacts={contacts}
        clients={clients}
        onOpenUser={openUser}
      />,
    );
    await screen.findByTestId('interaction-data-table');
    await waitFor(() => expect(mocks.getUserAvatarUrlsBatchAction).toHaveBeenCalledWith(['user-1'], 'tenant-1'));

    const columns = mocks.tableProps?.columns as Array<Record<string, any>>;
    const renderCell = (dataIndex: string) => {
      const column = columns.find((candidate) => candidate.dataIndex === dataIndex);
      return column?.render(interaction[dataIndex as keyof typeof interaction], interaction);
    };

    render(
      <div>
        {renderCell('client_name')}
        {renderCell('contact_name')}
        {renderCell('user_name')}
        {renderCell('status_name')}
      </div>,
    );

    expect(screen.getByTestId('client-avatar')).toBeTruthy();
    expect(screen.getByTestId('contact-avatar')).toBeTruthy();
    expect(screen.getByTestId('user-avatar')).toBeTruthy();
    expect(screen.getByText('In Progress').parentElement?.className).toContain('rounded-full');

    fireEvent.click(document.getElementById('overall-interaction-client-interaction-1')!);
    fireEvent.click(document.getElementById('overall-interaction-contact-interaction-1')!);
    fireEvent.click(document.getElementById('overall-interaction-user-interaction-1')!);

    expect(mocks.openClientDrawer).toHaveBeenCalledWith('client-1');
    expect(mocks.openContactDrawer).toHaveBeenCalledWith('contact-1', expect.objectContaining({
      onChangesSaved: expect.any(Function),
    }));
    expect(openUser).toHaveBeenCalledWith('user-1', expect.any(Function));
    expect(mocks.openDrawer).not.toHaveBeenCalled();
  });

  it('keeps the status palette theme-driven', () => {
    const source = fs.readFileSync(path.resolve(__dirname, './OverallInteractionsFeed.tsx'), 'utf8');

    expect(source).toContain("'var(--color-primary-500)'");
    expect(source).toContain("'var(--color-secondary-700)'");
    expect(source).toContain("'var(--color-text-500)'");
    expect(source).not.toContain("'99 102 241'");
    expect(source).not.toContain("'59 130 246'");
    expect(source).not.toContain("'20 184 166'");
    expect(source).not.toContain("'100 116 139'");
  });
});
