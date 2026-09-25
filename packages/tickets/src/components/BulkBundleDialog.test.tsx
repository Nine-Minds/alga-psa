// @vitest-environment jsdom
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BulkBundleDialog from './BulkBundleDialog';
import { TICKET_STATUS_FILTER_ALL, shouldApplyOpenOnlyStatusFilter } from '../lib/ticketStatusFilter';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  loadByIds: vi.fn(),
  status: vi.fn(),
  closedContext: vi.fn(),
  bundle: vi.fn(),
  translate: (key: string, fallback?: string | Record<string, unknown>) => {
    const template = typeof fallback === 'string' ? fallback : fallback?.defaultValue;
    if (typeof template !== 'string') return key;
    const values = typeof fallback === 'string' ? undefined : fallback;
    return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(values?.[name] ?? `{{${name}}}`));
  },
}));

vi.mock('../actions/optimizedTicketActions', () => ({
  fetchTicketsWithPagination: mocks.fetch,
  loadTicketListItemsByIds: mocks.loadByIds,
}));
vi.mock('../actions/ticketBundleActions', () => ({
  bundleTicketsAction: mocks.bundle,
  getBundleMasterStatusAction: mocks.status,
  getBundleMasterClosedContextAction: mocks.closedContext,
}));
vi.mock('react-hot-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: mocks.translate }),
}));
vi.mock('@alga-psa/ui/components/AsyncSearchableSelect', async () => {
  const React = await import('react');
  function AsyncSearchableSelectMock({ id, onChange, loadOptions, placeholder }: {
    id: string;
    onChange: (value: string, option: { disabled?: boolean }) => void;
    loadOptions: (args: { search: string; page: number; limit: number }) => Promise<{ options: Array<{ value: string; label: string; disabled?: boolean; badge?: { text: string } }>; total: number }>;
    placeholder: string;
  }) {
    const [search, setSearch] = React.useState('');
    const [options, setOptions] = React.useState<Array<{ value: string; label: string; disabled?: boolean; badge?: { text: string } }>>([]);
    React.useEffect(() => {
      if (!search) return;
      void loadOptions({ search, page: 1, limit: 10 }).then(result => setOptions(result.options));
    }, [loadOptions, search]);
    return React.createElement('div', { id },
      React.createElement('input', { role: 'combobox', placeholder, value: search, onChange: (event: React.ChangeEvent<HTMLInputElement>) => setSearch(event.target.value) }),
      React.createElement('ul', { role: 'listbox' }, options.map(option => React.createElement('button', {
        key: option.value,
        role: 'option',
        type: 'button',
        'aria-disabled': option.disabled,
        onClick: () => {
          if (!option.disabled) {
            onChange(option.value, option);
            setSearch('');
          }
        },
      }, option.badge?.text, ' ', option.label))),
    );
  }
  return {
    default: AsyncSearchableSelectMock,
  };
});

if (!('ResizeObserver' in globalThis)) {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
function ticket(id: string, clientId = 'client-a', extra: Record<string, unknown> = {}) {
  return {
    ticket_id: id,
    ticket_number: id.toUpperCase(),
    title: `Ticket ${id}`,
    client_id: clientId,
    client_name: clientId,
    master_ticket_id: null,
    bundle_master_ticket_number: null,
    bundle_child_count: 0,
    ...extra,
  } as never;
}

function getElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Expected element #${id} to exist`);
  return element;
}

function renderDialog({
  initialTicketIds = ['one'],
  knownRows = [[ticket('one')]],
  onClose = vi.fn(),
  onBundled = vi.fn(),
}: {
  initialTicketIds?: string[];
  knownRows?: ReturnType<typeof ticket>[][];
  onClose?: () => void;
  onBundled?: () => void;
} = {}) {
  render(<BulkBundleDialog
    id="bundle-test"
    isOpen
    onClose={onClose}
    initialTicketIds={initialTicketIds}
    knownRows={knownRows}
    onBundled={onBundled}
  />);
  return { onClose, onBundled };
}

async function openSearch(search = 'TWO') {
  const user = userEvent.setup();
  const picker = document.getElementById('bundle-test-bundle-add-ticket-search');
  if (!picker) throw new Error('Ticket search picker was not rendered');
  const input = await screen.findByPlaceholderText('Search tickets by number or title');
  await user.clear(input);
  await user.type(input, search);
  expect(input).toHaveValue(search);
  await new Promise(resolve => setTimeout(resolve, 350));
  await waitFor(() => expect(mocks.fetch).toHaveBeenCalled());
  return input;
}

async function chooseSearchResult(name: RegExp | string) {
  const result = await screen.findByText(name);
  fireEvent.click(result);
  return result;
}

describe('BulkBundleDialog', () => {
  beforeEach(() => {
    mocks.fetch.mockReset();
    mocks.loadByIds.mockReset();
    mocks.status.mockReset();
    mocks.closedContext.mockReset();
    mocks.bundle.mockReset();
    mocks.fetch.mockResolvedValue({ tickets: [], totalCount: 0 });
    mocks.loadByIds.mockImplementation(async (_filters, ids: string[]) => ({ tickets: ids.map(id => ticket(id)) }));
    mocks.status.mockResolvedValue({ masterTicketIds: [] });
    mocks.closedContext.mockResolvedValue({ isClosed: false, allowedChoices: [], hasResolutionComment: false, masterStatusName: 'Open' });
    mocks.bundle.mockResolvedValue({ success: true });
  });

  it('seeds initial members and resolves off-page ids', async () => {
    renderDialog({ initialTicketIds: ['one', 'off-page'], knownRows: [[ticket('one')]] });
    expect(await screen.findByText('OFF-PAGE')).toBeTruthy();
    expect(mocks.loadByIds).toHaveBeenCalledWith(expect.objectContaining({ boardFilterState: 'all' }), ['off-page']);
    expect(within(getElement('bundle-test-bundle-members')).getAllByRole('listitem')).toHaveLength(2);
  });

  it('hydrates a closed off-page selected member with all statuses', async () => {
    const closed = ticket('closed-member', 'client-a', { is_closed: true });
    mocks.loadByIds.mockResolvedValue({ tickets: [closed] });
    renderDialog({ initialTicketIds: ['one', 'closed-member'], knownRows: [[ticket('one')]] });
    await waitFor(() => expect(mocks.loadByIds).toHaveBeenCalled());
    const filters = mocks.loadByIds.mock.calls[0][0];
    expect(filters.statusId).toBe(TICKET_STATUS_FILTER_ALL);
    expect(shouldApplyOpenOnlyStatusFilter(filters.statusId, filters.showOpenOnly)).toBe(false);
    expect(await screen.findByText('CLOSED-MEMBER')).toBeTruthy();
    expect(within(getElement('bundle-test-bundle-members')).getAllByRole('listitem')).toHaveLength(2);
  });

  it('reports the count of selected tickets that could not be resolved', async () => {
    mocks.loadByIds.mockResolvedValue({ tickets: [] });
    renderDialog({ initialTicketIds: ['one', 'missing'], knownRows: [[ticket('one')]] });
    expect(await screen.findByText('Could not load 1 selected ticket(s).')).toBeTruthy();
  });

  it('adds a search result and submits the selected master and children', async () => {
    const { onBundled } = renderDialog();
    mocks.fetch.mockResolvedValue({ tickets: [ticket('two')], totalCount: 1 });
    expect(screen.getByRole('button', { name: 'Bundle Tickets' })).toBeDisabled();
    await openSearch();
    expect(mocks.fetch).toHaveBeenCalledWith(expect.objectContaining({
      searchQuery: 'TWO',
      bundleView: 'individual',
      boardFilterState: 'all',
      showOpenOnly: false,
    }), 1, 10);
    await chooseSearchResult(/TWO – Ticket two/);
    await waitFor(() => expect(within(getElement('bundle-test-bundle-members')).getAllByRole('listitem')).toHaveLength(2));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Bundle Tickets' })).toBeEnabled());
    expect(screen.getByRole('button', { name: 'Bundle Tickets' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Bundle Tickets' }));
    await waitFor(() => expect(mocks.bundle).toHaveBeenCalledWith(expect.objectContaining({
      masterTicketId: 'one',
      childTicketIds: ['two'],
    })));
    expect(onBundled).toHaveBeenCalledOnce();
  });

  it('shows Added and in-bundle badges without allowing either result to be selected', async () => {
    renderDialog({ initialTicketIds: ['one', 'two'], knownRows: [[ticket('one'), ticket('two')]] });
    mocks.fetch.mockResolvedValue({
      tickets: [
        ticket('one'),
        ticket('child', 'client-a', { master_ticket_id: 'outside-master', bundle_master_ticket_number: 'M-1' }),
      ],
      totalCount: 2,
    });
    await openSearch();
    const list = screen.getByRole('listbox');
    const addedOption = await within(list).findByRole('option', { name: /Added.*ONE – Ticket one/ });
    const bundledOption = await within(list).findByRole('option', { name: /In bundle #M-1.*CHILD – Ticket child/ });
    expect(addedOption).toHaveAttribute('aria-disabled', 'true');
    expect(bundledOption).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(addedOption);
    fireEvent.click(bundledOption);
    expect(within(getElement('bundle-test-bundle-members')).getAllByRole('listitem')).toHaveLength(2);
  });

  it('adds a bundle master result and locks it as the master', async () => {
    mocks.fetch.mockResolvedValue({ tickets: [ticket('two', 'client-a', { bundle_child_count: 2 })], totalCount: 1 });
    mocks.status.mockImplementation(async ({ ticketIds }: { ticketIds: string[] }) => ({
      masterTicketIds: ticketIds.includes('two') ? ['two'] : [],
    }));
    renderDialog();
    await openSearch();
    const masterOption = await screen.findByRole('option', { name: /Bundle master.*TWO – Ticket two/ });
    expect(masterOption).toHaveAttribute('aria-disabled', 'false');
    await chooseSearchResult(/TWO – Ticket two/);
    await waitFor(() => expect(mocks.status).toHaveBeenLastCalledWith({ ticketIds: ['one', 'two'] }));
    await waitFor(() => expect(document.getElementById('bundle-test-bundle-master-select')).toBeDisabled());
    expect(document.getElementById('bundle-test-bundle-master-select')).toBeDisabled();
    expect(screen.getByText('Master')).toBeTruthy();
  });

  it('shows closed status for a selectable closed result', async () => {
    const closed = ticket('closed', 'client-a', { is_closed: true });
    mocks.fetch.mockResolvedValue({ tickets: [closed], totalCount: 1 });
    mocks.closedContext.mockImplementation(async ({ masterTicketId }: { masterTicketId: string }) => ({
      isClosed: masterTicketId === 'closed',
      allowedChoices: masterTicketId === 'closed' ? ['keep_closed'] : [],
      hasResolutionComment: false,
      masterStatusName: masterTicketId === 'closed' ? 'Closed' : 'Open',
    }));
    renderDialog();
    await openSearch();
    const filters = mocks.fetch.mock.calls.at(-1)?.[0];
    expect(filters.statusId).toBe(TICKET_STATUS_FILTER_ALL);
    expect(shouldApplyOpenOnlyStatusFilter(filters.statusId, filters.showOpenOnly)).toBe(false);
    const closedOption = await screen.findByRole('option', { name: /Closed.*CLOSED – Ticket closed/ });
    expect(closedOption).toHaveAttribute('aria-disabled', 'false');
    await chooseSearchResult(/CLOSED – Ticket closed/);
    await waitFor(() => expect(within(getElement('bundle-test-bundle-members')).getAllByRole('listitem')).toHaveLength(2));
    fireEvent.click(getElement('bundle-test-bundle-member-remove-one'));
    expect(await screen.findByText("This bundle's master is closed")).toBeTruthy();
    expect(screen.getByText('Add and keep master closed')).toBeTruthy();
  });

  it('blocks confirm when two existing masters are present', async () => {
    mocks.status.mockResolvedValue({ masterTicketIds: ['one', 'two'] });
    renderDialog({ initialTicketIds: ['one', 'two'], knownRows: [[ticket('one'), ticket('two')]] });
    expect(await screen.findByText(/Multiple selected tickets are already bundle masters/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Bundle Tickets' })).toBeDisabled();
  });

  it('removes a member and reassigns master to the first remaining member', async () => {
    renderDialog({ initialTicketIds: ['one', 'two'], knownRows: [[ticket('one'), ticket('two')]] });
    await waitFor(() => expect(mocks.status).toHaveBeenCalled());
    fireEvent.click(getElement('bundle-test-bundle-member-remove-one'));
    const members = getElement('bundle-test-bundle-members');
    expect(within(members).getAllByRole('listitem')).toHaveLength(1);
    expect(within(members).getByText('TWO').closest('li')).toHaveTextContent('Master');
  });

  it('clears an existing-master lock when that member is removed', async () => {
    mocks.status.mockImplementation(async ({ ticketIds }: { ticketIds: string[] }) => ({
      masterTicketIds: ticketIds.includes('one') ? ['one'] : [],
    }));
    renderDialog({ initialTicketIds: ['one', 'two'], knownRows: [[ticket('one'), ticket('two')]] });
    await waitFor(() => expect(document.getElementById('bundle-test-bundle-master-select')).toBeDisabled());
    fireEvent.click(getElement('bundle-test-bundle-member-remove-one'));
    await waitFor(() => expect(document.getElementById('bundle-test-bundle-master-select')).not.toBeDisabled());
    expect(within(getElement('bundle-test-bundle-members')).getAllByRole('listitem')).toHaveLength(1);
  });

  it('requires two members before enabling confirm', async () => {
    renderDialog();
    await waitFor(() => expect(mocks.status).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: 'Bundle Tickets' })).toBeDisabled();
    expect(screen.getByText('Add at least one more ticket to bundle.')).toBeTruthy();
  });

  it('asks before bundling when a searched ticket adds a second client', async () => {
    mocks.fetch.mockResolvedValue({ tickets: [ticket('two', 'client-b')], totalCount: 1 });
    renderDialog();
    await openSearch();
    await chooseSearchResult(/TWO – Ticket two/);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Bundle Tickets' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Bundle Tickets' }));
    expect((await screen.findAllByText('This bundle includes tickets from multiple clients. Confirm that you want to proceed.')).length).toBeGreaterThan(0);
    expect(mocks.bundle).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Proceed' }));
    await waitFor(() => expect(mocks.bundle).toHaveBeenCalledOnce());
  });

  it('includes off-page resolved clients in the multi-client confirmation', async () => {
    mocks.loadByIds.mockResolvedValue({ tickets: [ticket('off-page', 'client-b')] });
    renderDialog({ initialTicketIds: ['one', 'off-page'], knownRows: [[ticket('one')]] });
    await screen.findByText('OFF-PAGE');
    const confirmButton = screen.getByRole('button', { name: 'Bundle Tickets' });
    await waitFor(() => expect(confirmButton).toBeEnabled());
    fireEvent.click(confirmButton);
    expect((await screen.findAllByText('This bundle includes tickets from multiple clients. Confirm that you want to proceed.')).length).toBeGreaterThan(0);
    expect(mocks.bundle).not.toHaveBeenCalled();
  });

  it('shows a newly added result as Added on a subsequent search', async () => {
    mocks.fetch.mockResolvedValue({ tickets: [ticket('two')], totalCount: 1 });
    renderDialog();
    await openSearch();
    await chooseSearchResult(/TWO – Ticket two/);
    await openSearch();
    const addedOption = await screen.findByRole('option', { name: /Added.*TWO – Ticket two/ });
    expect(addedOption).toHaveAttribute('aria-disabled', 'true');
  });

  it('cancel closes without bundling or changing list-selection callbacks', () => {
    const { onClose, onBundled } = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(onBundled).not.toHaveBeenCalled();
    expect(mocks.bundle).not.toHaveBeenCalled();
  });
});
