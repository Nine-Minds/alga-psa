// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { ClientPickerSearchProvider } from '@alga-psa/ui/context/ClientPickerSearchContext';

const { listCustodyQueue } = vi.hoisted(() => ({
  listCustodyQueue: vi.fn(async (_filters: any) => ({
    rows: [], total: 60, tabCounts: {},
  })),
}));
vi.mock('../../actions/assetCustodyActions', () => ({ listCustodyQueue }));
vi.mock('../../context/AssetCrossFeatureContext', () => ({ useAssetCrossFeature: () => ({}) }));
vi.mock('./custodyClient', () => ({
  custodyOutcome: (data: any) => ({ ok: true, data }),
  useCustodyLocations: () => ({ locations: [], canUpdate: false }),
  useCustodyUsers: () => [],
}));
vi.mock('./CustodyFields', () => ({ usePartyLabels: () => ({}), usePurposeOptions: () => [] }));
vi.mock('./CustodyDialogs', () => ({ CustodyStepDialog: () => null }));
vi.mock('@alga-psa/core', () => ({
  getCurrentDateInUserTimeZone: () => '2026-11-02', formatCalendarDate: (date: string) => date,
}));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (key: string, options?: any) => options?.defaultValue ?? key }),
}));
vi.mock('@alga-psa/ui/ui-reflection/useAutomationIdAndRegister', () => ({
  useAutomationIdAndRegister: (info: any) => ({ automationIdProps: { id: info.id }, updateMetadata: vi.fn() }),
}));
vi.mock('@alga-psa/ui/components/ClientAvatar', () => ({ default: () => null }));
vi.mock('@alga-psa/ui/components/CustomTabs', () => ({ CustomTabs: () => null }));
vi.mock('@alga-psa/ui/components/UserPicker', () => ({ default: () => null }));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({ id, value, options, onValueChange }: any) => (
    <select aria-label={id} value={value} onChange={(e) => onValueChange(e.target.value)}>
      {options.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  ),
}));
vi.mock('@alga-psa/ui/components/DataTable', () => ({
  DataTable: ({ onPageChange }: any) => <button onClick={() => onPageChange(2)}>Next page</button>,
}));

import { CustodyQueue } from './CustodyQueue';

vi.stubGlobal('ResizeObserver', class {
  observe() {}
  unobserve() {}
  disconnect() {}
});
const scrollIntoView = Element.prototype.scrollIntoView;
Element.prototype.scrollIntoView = vi.fn();
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Element.prototype.scrollIntoView = scrollIntoView;
});

it('searches clients on demand and resets queue pagination when the client filter changes', async () => {
  const searchClients = vi.fn(async (_params: any) => ({
    clients: [{ client_id: 'acme', client_name: 'Acme Corp', client_type: 'company' as const }],
    total: 1,
  }));
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ClientPickerSearchProvider value={{ searchClients }}>
        <CustodyQueue />
      </ClientPickerSearchProvider>
    </SWRConfig>,
  );
  await waitFor(() => expect(listCustodyQueue).toHaveBeenCalledWith(expect.objectContaining({ page: 1 })));
  expect(searchClients).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Next page'));
  await waitFor(() => expect(listCustodyQueue).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 })));
  fireEvent.click(document.getElementById('custody-client-filter-trigger')!);
  fireEvent.click(await screen.findByText('Acme Corp'));
  expect(searchClients).toHaveBeenCalledWith(expect.objectContaining({ page: 0, status: 'active', clientType: 'all' }));
  await waitFor(() => expect(listCustodyQueue).toHaveBeenLastCalledWith(expect.objectContaining({
    client_id: 'acme', page: 1,
  })));
});
