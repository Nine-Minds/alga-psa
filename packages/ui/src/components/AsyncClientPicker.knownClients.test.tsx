/** @vitest-environment jsdom */

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AsyncClientPicker, type ClientPickerSearchFn } from './AsyncClientPicker';
import { lookupClientsByIds } from '../hooks/useClientNames';

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
      return String(o.defaultValue ?? _key);
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

const row = (id: string, name: string) => ({ client_id: id, client_name: name, client_type: 'company' });

describe('AsyncClientPicker knownClients', () => {
  it('shows a known selection without looking it up again', async () => {
    const searchClients: ClientPickerSearchFn = vi.fn(async () => ({ clients: [], total: 0 }));
    render(
      <AsyncClientPicker
        id="cp"
        searchClients={searchClients}
        selectedClientId="a"
        onSelect={() => {}}
        knownClients={[row('a', 'Acme')]}
      />,
    );
    expect(await screen.findByText('Acme')).toBeTruthy();
    expect(searchClients).not.toHaveBeenCalled();
  });

  it('looks up a selection that is not known', async () => {
    const searchClients: ClientPickerSearchFn = vi.fn(async (params) => ({
      clients: [row('b', 'Birch')].filter((c) => params.ids?.includes(c.client_id)),
      total: 1,
    }));
    render(
      <AsyncClientPicker id="cp" searchClients={searchClients} selectedClientId="b" onSelect={() => {}} knownClients={[row('a', 'Acme')]} />,
    );
    await waitFor(() => expect(screen.getByText('Birch')).toBeTruthy());
    expect(searchClients).toHaveBeenCalledTimes(1);
  });
});

describe('lookupClientsByIds', () => {
  it('asks once per chunk of 100 distinct ids and skips a failing chunk', async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `c${i}`);
    const search = vi.fn(async (params: { ids?: string[] }) => {
      if (params.ids!.includes('c100')) throw new Error('boom');
      return { clients: params.ids!.map((id) => row(id, id)), total: params.ids!.length };
    }) as unknown as ClientPickerSearchFn;
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const rows = await lookupClientsByIds(search, [...ids, ...ids, '']);
    spy.mockRestore();
    expect(search).toHaveBeenCalledTimes(3);
    expect(rows).toHaveLength(150);
  });
});
