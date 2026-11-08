/** @vitest-environment jsdom */

import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ClientPicker } from './ClientPicker';
import { AsyncClientPicker, type PickerClientOption } from './AsyncClientPicker';
import { ClientTagsProvider } from '../context/ClientTagsContext';
import { ClientPickerSearchProvider } from '../context/ClientPickerSearchContext';

vi.mock('../ui-reflection/useAutomationIdAndRegister', () => ({
  useAutomationIdAndRegister: (info: any) => ({ automationIdProps: { id: info.id }, updateMetadata: vi.fn() }),
}));
vi.mock('./CustomSelect', () => ({
  default: ({ id, value, onValueChange, options }: any) => (
    <select data-testid={id} value={value} onChange={(e) => onValueChange(e.target.value)}>
      {options.map((o: any) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  ),
}));
vi.mock('./tags/TagFilter', () => ({
  TagFilter: ({ id, tags, onToggleTag }: any) => (
    <div data-testid={id}>
      {tags.map((t: any) => (
        <button key={t.tag_text} onClick={() => onToggleTag(t.tag_text)}>{`tag:${t.tag_text}`}</button>
      ))}
    </div>
  ),
}));
vi.mock('./ClientAvatar', () => ({
  default: ({ clientName }: any) => <span data-testid="avatar">{clientName[0]}</span>,
}));

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

const mk = (n: number, prefix = 'Client'): PickerClientOption[] =>
  Array.from({ length: n }, (_, i) => ({
    client_id: `${prefix}-${i}`,
    client_name: `${prefix} ${i}`,
    client_type: 'company',
    is_inactive: false,
    logoUrl: null,
  }));

const open = () => fireEvent.click(screen.getByRole('combobox'));

describe('AsyncClientPicker', () => {
  const fetchClientTags = vi.fn(async () => []);
  const fetchClientTagOptions = vi.fn(async () => [
    { tag_id: 't1', tag_text: 'vip', tagged_id: '', tagged_type: 'client' as const },
  ]);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const renderPicker = (props: Partial<React.ComponentProps<typeof AsyncClientPicker>> & { searchClients: any }) =>
    render(
      <ClientTagsProvider value={{ fetchClientTags, fetchClientTagOptions }}>
        <AsyncClientPicker id="cp" onSelect={vi.fn()} selectedClientId={null} debounceMs={0} {...props} />
      </ClientTagsProvider>
    );

  it('opens with one small page-0 query and no all-ids tag fetch', async () => {
    const searchClients = vi.fn(async (_p?: any) => ({ clients: mk(3), total: 3 }));
    renderPicker({ searchClients });
    open();
    await screen.findByText('Client 0');
    expect(searchClients).toHaveBeenCalledTimes(1);
    const args = searchClients.mock.calls[0][0] as any;
    expect(args.page).toBe(0);
    expect(args.pageSize).toBeGreaterThanOrEqual(25);
    expect(args.pageSize).toBeLessThanOrEqual(50);
    expect(args.ids).toBeUndefined();
    expect(fetchClientTags).not.toHaveBeenCalled();
  });

  it('debounces typing and searches on the server', async () => {
    const searchClients = vi.fn(async (_p?: any) => ({ clients: mk(1), total: 1 }));
    renderPicker({ searchClients, debounceMs: 80 });
    open();
    await waitFor(() => expect(searchClients).toHaveBeenCalledTimes(1));
    const input = screen.getByPlaceholderText('Search clients...');
    fireEvent.change(input, { target: { value: 'a' } });
    fireEvent.change(input, { target: { value: 'ac' } });
    expect(searchClients).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(searchClients).toHaveBeenCalledTimes(2));
    expect(searchClients.mock.calls[1][0]).toMatchObject({ search: 'ac', page: 0 });
  });

  it('loads the next page and appends results', async () => {
    const searchClients = vi.fn(async (p: any) =>
      p.page === 0 ? { clients: mk(25), total: 30 } : { clients: mk(5, 'More'), total: 30 }
    );
    renderPicker({ searchClients });
    open();
    await screen.findByText('Client 24');
    const list = screen.getByRole('listbox');
    const scrollEl = list;
    Object.defineProperty(scrollEl, 'scrollHeight', { value: 1000, configurable: true });
    Object.defineProperty(scrollEl, 'clientHeight', { value: 300, configurable: true });
    Object.defineProperty(scrollEl, 'scrollTop', { value: 700, configurable: true });
    fireEvent.scroll(scrollEl);
    await screen.findByText('More 4');
    expect(searchClients.mock.calls[1][0]).toMatchObject({ page: 1 });
    expect(screen.getByText('Client 0')).toBeTruthy();
  });

  it('hydrates a selected value that is not on the loaded page, once', async () => {
    const searchClients = vi.fn(async (p: any) =>
      p.ids ? { clients: [{ client_id: 'far', client_name: 'Far Away Co', client_type: 'company' }], total: 1 } : { clients: mk(2), total: 2 }
    );
    const { rerender } = renderPicker({ searchClients, selectedClientId: 'far' });
    await screen.findByText('Far Away Co');
    expect(searchClients).toHaveBeenCalledTimes(1);
    expect(searchClients).toHaveBeenCalledWith({ ids: ['far'] });
    rerender(
      <ClientTagsProvider value={{ fetchClientTags, fetchClientTagOptions }}>
        <AsyncClientPicker id="cp" onSelect={vi.fn()} selectedClientId="far" searchClients={searchClients} debounceMs={0} className="x" />
      </ClientTagsProvider>
    );
    expect(searchClients).toHaveBeenCalledTimes(1);
  });

  it('renders disabled clients with the tooltip and blocks selection', async () => {
    const onSelect = vi.fn();
    const searchClients = vi.fn(async (_p?: any) => ({ clients: mk(2), total: 2 }));
    renderPicker({ searchClients, onSelect, disabledClientIds: new Set(['Client-0']), disabledTooltip: 'Has contract' });
    open();
    const label = await screen.findByText('Client 0');
    const item = label.closest('[aria-disabled="true"]') as HTMLElement;
    expect(item).not.toBeNull();
    expect(item.getAttribute('title')).toBe('Has contract');
    expect(screen.getByText('Has contract')).toBeTruthy();
    fireEvent.click(label);
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Client 1'));
    expect(onSelect).toHaveBeenCalledWith('Client-1');
  });

  it('passes status/type/tag filters to the action and resets to page 0', async () => {
    const searchClients = vi.fn(async (_p?: any) => ({ clients: mk(2), total: 2 }));
    renderPicker({ searchClients, excludeIds: ['skip'] });
    open();
    await screen.findByText('Client 0');
    expect(searchClients.mock.calls[0][0]).toMatchObject({ status: 'active', clientType: 'all', excludeIds: ['skip'] });

    fireEvent.change(screen.getByTestId('cp-state-filter'), { target: { value: 'inactive' } });
    await waitFor(() => expect(searchClients).toHaveBeenCalledTimes(2));
    fireEvent.change(screen.getByTestId('cp-type-filter'), { target: { value: 'individual' } });
    await waitFor(() => expect(searchClients).toHaveBeenCalledTimes(3));
    fireEvent.click(await screen.findByText('tag:vip'));
    await waitFor(() => expect(searchClients).toHaveBeenCalledTimes(4));
    expect(searchClients.mock.calls[3][0]).toMatchObject({ status: 'inactive', clientType: 'individual', tags: ['vip'], page: 0 });
    expect(fetchClientTags).not.toHaveBeenCalled();
  });

  it('does not refetch when a new but equal disabled Set / tooltip arrives while open', async () => {
    const searchClients = vi.fn(async (_p?: any) => ({ clients: mk(2), total: 2 }));
    const ui = (set: Set<string>, tip: string) => (
      <ClientTagsProvider value={{ fetchClientTags, fetchClientTagOptions }}>
        <AsyncClientPicker id="cp" onSelect={vi.fn()} selectedClientId={null} debounceMs={0}
          searchClients={searchClients} disabledClientIds={set} disabledTooltip={tip} />
      </ClientTagsProvider>
    );
    const { rerender } = render(ui(new Set(['Client-0']), 'A'));
    open();
    await screen.findByText('Client 0');
    expect(searchClients).toHaveBeenCalledTimes(1);
    rerender(ui(new Set(['Client-0']), 'B'));
    rerender(ui(new Set(['Client-0']), 'B'));
    await new Promise((r) => setTimeout(r, 50));
    expect(searchClients).toHaveBeenCalledTimes(1);
  });

  it('exposes the trigger as `${id}-trigger`', () => {
    renderPicker({ searchClients: vi.fn(async (_p?: any) => ({ clients: [], total: 0 })) });
    expect(screen.getByRole('combobox').getAttribute('id')).toBe('cp-trigger');
  });

  it('keeps `${id}-option-${clientId}` in the DOM and clickable', async () => {
    const onSelect = vi.fn();
    const searchClients = vi.fn(async (_p?: any) => ({ clients: mk(2), total: 2 }));
    renderPicker({ id: 'client-picker', searchClients, onSelect });
    open();
    await screen.findByText('Client 1');
    const option = document.querySelector('#client-picker-option-Client-1') as HTMLElement;
    expect(option).not.toBeNull();
    fireEvent.click(option);
    expect(onSelect).toHaveBeenCalledWith('Client-1');
  });

  it('does not fetch when filters change while closed', async () => {
    const searchClients = vi.fn(async (_p?: any) => ({ clients: mk(1), total: 1 }));
    const ui = (state: 'active' | 'all') => (
      <AsyncClientPicker id="cp" onSelect={vi.fn()} selectedClientId={null} debounceMs={0}
        searchClients={searchClients} filterState={state} />
    );
    const { rerender } = render(ui('active'));
    rerender(ui('all'));
    await new Promise((r) => setTimeout(r, 50));
    expect(searchClients).not.toHaveBeenCalled();
    open();
    await screen.findByText('Client 0');
    expect(searchClients).toHaveBeenCalledTimes(1);
    expect(searchClients.mock.calls[0][0]).toMatchObject({ status: 'all' });
  });

  it('renders the add-new footer and fires onAddNew', async () => {
    const onAddNew = vi.fn();
    renderPicker({ searchClients: vi.fn(async (_p?: any) => ({ clients: mk(1), total: 1 })), onAddNew });
    open();
    fireEvent.click(await screen.findByText('Add new client'));
    expect(onAddNew).toHaveBeenCalledTimes(1);
  });
});

describe('ClientPicker', () => {
  it('delegates to async mode when searchClients is given', async () => {
    const searchClients = vi.fn(async (_p?: any) => ({ clients: mk(1), total: 1 }));
    render(<ClientPicker id="cp2" searchClients={searchClients} onSelect={vi.fn()} selectedClientId={null} />);
    open();
    await screen.findByText('Client 0');
    expect(searchClients).toHaveBeenCalled();
  });

  it('keeps the deprecated in-memory clients prop working, with tags only for the given ids', async () => {
    const fetchClientTags = vi.fn(async () => []);
    const onSelect = vi.fn();
    const clients = [
      { client_id: 'a', client_name: 'Alpha', client_type: 'company', is_inactive: false },
      { client_id: 'b', client_name: 'Beta', client_type: 'company', is_inactive: false },
    ] as any;
    render(
      <ClientTagsProvider value={{ fetchClientTags }}>
        <ClientPicker id="cp3" clients={clients} onSelect={onSelect} selectedClientId="a" />
      </ClientTagsProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: /Alpha/ }));
    fireEvent.change(screen.getByPlaceholderText('Search clients...'), { target: { value: 'bet' } });
    expect(screen.queryByText('Alpha', { selector: 'div' })).toBeNull();
    fireEvent.click(screen.getByText('Beta'));
    expect(onSelect).toHaveBeenCalledWith('b');
    await waitFor(() => expect(fetchClientTags).toHaveBeenCalledWith(['a', 'b']));
  });

  it('is async by default (no clients prop) and uses the context searcher', async () => {
    const searchClients = vi.fn(async (_p?: any) => ({ clients: mk(1), total: 1 }));
    render(
      <ClientPickerSearchProvider value={{ searchClients }}>
        <ClientPicker id="cp4" onSelect={vi.fn()} selectedClientId={null} />
      </ClientPickerSearchProvider>
    );
    open();
    await screen.findByText('Client 0');
    expect(searchClients).toHaveBeenCalled();
  });

  it('prefers an explicit searchClients prop over the context searcher', async () => {
    const fromContext = vi.fn(async (_p?: any) => ({ clients: mk(1, 'Ctx'), total: 1 }));
    const fromProp = vi.fn(async (_p?: any) => ({ clients: mk(1, 'Prop'), total: 1 }));
    render(
      <ClientPickerSearchProvider value={{ searchClients: fromContext }}>
        <ClientPicker id="cp5" searchClients={fromProp} onSelect={vi.fn()} selectedClientId={null} />
      </ClientPickerSearchProvider>
    );
    open();
    await screen.findByText('Prop 0');
    expect(fromContext).not.toHaveBeenCalled();
  });

  it('logs an error and renders an empty in-memory picker when no searcher is available', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<ClientPicker id="cp6" onSelect={vi.fn()} selectedClientId={null} />);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('No client searcher'));
    error.mockRestore();
  });
});
