/** @vitest-environment jsdom */

import React, { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AsyncClientPicker, type ClientPickerSearchFn } from './AsyncClientPicker';
import { chunkIds } from '../hooks/useClientNames';

vi.mock('../ui-reflection/useAutomationIdAndRegister', () => ({
  useAutomationIdAndRegister: (info: any) => ({ automationIdProps: { id: info.id }, updateMetadata: vi.fn() }),
}));
vi.mock('./CustomSelect', () => ({ default: () => null }));
vi.mock('./tags/TagFilter', () => ({ TagFilter: () => null }));
vi.mock('./ClientAvatar', () => ({ default: () => null }));
vi.mock('../lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, options: unknown) => {
      const o = (typeof options === 'string' ? { defaultValue: options } : options ?? {}) as Record<string, unknown>;
      return String(o.defaultValue ?? _key).replace('{{count}}', String(o.count ?? ''));
    },
  }),
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

// The open list's search input is also a combobox; the trigger comes first in the DOM.
const trigger = () => screen.getAllByRole('combobox')[0];
const row = (id: string, name: string) => ({ client_id: id, client_name: name, client_type: 'company' });
const PAGE = [row('a', 'Acme'), row('b', 'Birch')];

function setup(initial: string[] = [], search?: ClientPickerSearchFn) {
  const searchClients: ClientPickerSearchFn =
    search ??
    vi.fn(async (params) =>
      params.ids ? { clients: [row('z', 'Zenith')].filter((c) => params.ids!.includes(c.client_id)), total: 1 } : { clients: PAGE, total: 2 },
    );
  const onChange = vi.fn();
  function Harness() {
    const [ids, setIds] = useState<string[]>(initial);
    return (
      <AsyncClientPicker
        id="cp"
        searchClients={searchClients}
        selectedClientIds={ids}
        onSelectedClientIdsChange={(next) => {
          onChange(next);
          setIds(next);
        }}
        debounceMs={0}
        placeholder="All Clients"
      />
    );
  }
  render(<Harness />);
  return { searchClients: searchClients as ReturnType<typeof vi.fn>, onChange };
}

describe('AsyncClientPicker multi (T008)', () => {
  it('ticks two rows, keeps the list open, checks them, and summarises the selection', async () => {
    const { onChange } = setup();
    expect(trigger().textContent).toContain('All Clients');
    fireEvent.click(trigger());
    fireEvent.click(await screen.findByText('Acme'));
    expect(onChange).toHaveBeenLastCalledWith(['a']);
    // still open: the second row is there to click
    fireEvent.click(screen.getByText('Birch'));
    expect(onChange).toHaveBeenLastCalledWith(['a', 'b']);
    expect(screen.getAllByLabelText('selected')).toHaveLength(2);
    expect(trigger().textContent).toContain('2 clients');
  });

  it('shows the single selected name, and Clear empties the selection', async () => {
    const { onChange } = setup();
    fireEvent.click(trigger());
    fireEvent.click(await screen.findByText('Acme'));
    await waitFor(() => expect(trigger().textContent).toContain('Acme'));
    fireEvent.click(screen.getByText('Clear'));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it('hydrates selected ids that are off the loaded page with one ids lookup', async () => {
    const { searchClients } = setup(['z']);
    await waitFor(() => expect(trigger().textContent).toContain('Zenith'));
    const lookups = searchClients.mock.calls.filter(([params]) => params.ids);
    expect(lookups).toHaveLength(1);
    expect(lookups[0][0].ids).toEqual(['z']);
  });

  it('chunks id lookups at the server cap of 100', () => {
    const ids = Array.from({ length: 250 }, (_, i) => String(i));
    expect(chunkIds(ids).map((c) => c.length)).toEqual([100, 100, 50]);
  });
});
