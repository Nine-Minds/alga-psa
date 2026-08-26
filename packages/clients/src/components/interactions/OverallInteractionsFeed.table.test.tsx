// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getInteractionsPage: vi.fn(),
  getAllInteractionTypes: vi.fn(),
  getInteractionStatuses: vi.fn(),
  openDrawer: vi.fn(),
  tableProps: null as Record<string, any> | null,
}));

vi.mock('@alga-psa/clients/actions', () => ({
  getInteractionsPage: mocks.getInteractionsPage,
  getAllInteractionTypes: mocks.getAllInteractionTypes,
  getInteractionStatuses: mocks.getInteractionStatuses,
}));

vi.mock('@alga-psa/ui', () => ({ useDrawer: () => ({ openDrawer: mocks.openDrawer }) }));
vi.mock('@alga-psa/user-composition/actions', () => ({ getUserAvatarUrlsBatchAction: vi.fn() }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => {
  const t = (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key;
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
vi.mock('./InteractionDetails', () => ({ default: () => <div /> }));
vi.mock('../contacts/QuickAddContact', () => ({ default: () => null }));

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
};

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
});
