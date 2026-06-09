// @vitest-environment jsdom
/**
 * T050–T053 — HuduCompanyMappingManager component (company-mapping-ui group).
 *
 * jsdom + @testing-library, mirroring huduIntegrationSettings.component.test:
 * mapping actions, client list, ClientPicker (as a plain select), toast hook,
 * i18n, and UI primitives are all mocked; assertions run against the DOM.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import HuduCompanyMappingManager from '@ee/components/settings/integrations/hudu/HuduCompanyMappingManager';
import type { HuduCompanyMappingView } from '@ee/lib/actions/integrations/huduMappingActions';

const {
  syncHuduCompaniesMock,
  getHuduCompanyMappingsMock,
  setHuduCompanyMappingMock,
  clearHuduCompanyMappingMock,
  getAllClientsMock,
  toastMock,
} = vi.hoisted(() => ({
  syncHuduCompaniesMock: vi.fn(),
  getHuduCompanyMappingsMock: vi.fn(),
  setHuduCompanyMappingMock: vi.fn(),
  clearHuduCompanyMappingMock: vi.fn(),
  getAllClientsMock: vi.fn(),
  toastMock: vi.fn(),
}));

// Same module as the component's relative import (vitest dedupes by resolved id).
vi.mock('@ee/lib/actions/integrations/huduMappingActions', () => ({
  syncHuduCompanies: syncHuduCompaniesMock,
  getHuduCompanyMappings: getHuduCompanyMappingsMock,
  setHuduCompanyMapping: setHuduCompanyMappingMock,
  clearHuduCompanyMapping: clearHuduCompanyMappingMock,
}));

vi.mock('@alga-psa/clients/actions', () => ({
  getAllClients: getAllClientsMock,
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => {
  // Stable identity: the component memoizes callbacks on `t`.
  const t = (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key;
  return { useTranslation: () => ({ t }) };
});

vi.mock('@alga-psa/ui/hooks/use-toast', () => ({
  useToast: () => ({ toast: toastMock, toasts: [] }),
}));

vi.mock('@alga-psa/ui/components/Card', () => ({
  Card: ({ children, id }: { children: React.ReactNode; id?: string }) => <div id={id}>{children}</div>,
  CardHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  CardDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Badge', () => ({
  Badge: ({ children, id, variant }: { children: React.ReactNode; id?: string; variant?: string }) => (
    <span id={id} data-variant={variant}>
      {children}
    </span>
  ),
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, id, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { id?: string }) => (
    <button id={id} {...props}>
      {children}
    </button>
  ),
}));

vi.mock('@alga-psa/ui/components/Alert', () => ({
  Alert: ({ children, id, variant }: { children: React.ReactNode; id?: string; variant?: string }) => (
    <div id={id} role="alert" data-variant={variant}>
      {children}
    </div>
  ),
  AlertDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// ClientPicker as a plain select: '' = no selection, otherwise the client id.
vi.mock('@alga-psa/ui/components/ClientPicker', () => ({
  ClientPicker: ({
    id,
    clients = [],
    selectedClientId,
    onSelect,
    placeholder,
  }: {
    id?: string;
    clients?: Array<{ client_id: string; client_name: string }>;
    selectedClientId: string | null;
    onSelect: (clientId: string | null) => void;
    placeholder?: string;
  }) => (
    <select
      id={id}
      data-testid={id}
      value={selectedClientId ?? ''}
      onChange={(event) => onSelect(event.target.value === '' ? null : event.target.value)}
    >
      <option value="">{placeholder ?? ''}</option>
      {clients.map((client) => (
        <option key={client.client_id} value={client.client_id}>
          {client.client_name}
        </option>
      ))}
    </select>
  ),
}));

const clients = [
  { client_id: 'client-1', client_name: 'Acme Corp' },
  { client_id: 'client-2', client_name: 'Globex' },
  { client_id: 'client-3', client_name: 'Initech' },
];

function buildCompanies(): HuduCompanyMappingView[] {
  return [
    {
      hudu_company_id: 101,
      hudu_company_name: 'Acme Corp',
      id_in_integration: 'psa-101',
      url: 'https://docs.example.com/companies/101',
      mapping: { mapping_id: 'map-1', client_id: 'client-1', client_name: 'Acme Corp' },
      suggestion: null,
    },
    {
      hudu_company_id: 102,
      hudu_company_name: 'Globex',
      id_in_integration: null,
      url: null,
      mapping: null,
      suggestion: { client_id: 'client-2', client_name: 'Globex', source: 'exact_name', confidence: 0.9 },
    },
    {
      hudu_company_id: 103,
      hudu_company_name: 'Umbrella',
      id_in_integration: null,
      url: null,
      mapping: null,
      suggestion: null,
    },
  ];
}

function mockMappings(companies: HuduCompanyMappingView[]) {
  getHuduCompanyMappingsMock.mockResolvedValue({
    success: true,
    data: { companies, fetched_at: '2026-06-09T00:00:00.000Z', fromCache: true },
  });
}

async function renderManager() {
  render(<HuduCompanyMappingManager />);
  await screen.findByText('Umbrella');
}

describe('HuduCompanyMappingManager', () => {
  beforeEach(() => {
    syncHuduCompaniesMock.mockReset();
    getHuduCompanyMappingsMock.mockReset();
    setHuduCompanyMappingMock.mockReset();
    clearHuduCompanyMappingMock.mockReset();
    getAllClientsMock.mockReset();
    toastMock.mockReset();
    getAllClientsMock.mockResolvedValue(clients);
    mockMappings(buildCompanies());
  });

  it('T050: renders counters and one row per Hudu company', async () => {
    await renderManager();

    expect(document.getElementById('hudu-mapping-count-mapped')?.textContent).toBe('1 mapped');
    expect(document.getElementById('hudu-mapping-count-suggested')?.textContent).toBe('1 suggested');
    expect(document.getElementById('hudu-mapping-count-unmapped')?.textContent).toBe('1 unmapped');
    expect(document.getElementById('hudu-mapping-count-total')?.textContent).toBe('3 total');

    const bodyRows = document.querySelectorAll('tbody tr');
    expect(bodyRows).toHaveLength(3);
    expect(bodyRows[0].textContent).toContain('Acme Corp');
    expect(bodyRows[1].textContent).toContain('Globex');
    expect(bodyRows[2].textContent).toContain('Umbrella');
    // Company id + PSA integration id where present.
    expect(screen.getByText(/ID: 101/).textContent).toContain('PSA id: psa-101');
    expect(screen.getByText(/ID: 102/).textContent).not.toContain('PSA id');
  });

  it('T050: shows the empty state when no companies are cached', async () => {
    mockMappings([]);

    render(<HuduCompanyMappingManager />);

    await screen.findByText('No Hudu companies loaded yet.');
    expect(document.getElementById('hudu-mapping-count-total')?.textContent).toBe('0 total');
    expect(document.querySelector('table')).toBeNull();
  });

  it('T051: picker is pre-filled with the mapped client or the suggested match', async () => {
    await renderManager();

    expect((screen.getByTestId('hudu-client-picker-101') as HTMLSelectElement).value).toBe('client-1');
    expect((screen.getByTestId('hudu-client-picker-102') as HTMLSelectElement).value).toBe('client-2');
    expect((screen.getByTestId('hudu-client-picker-103') as HTMLSelectElement).value).toBe('');

    // The suggested pre-fill is visually marked with its source + confidence.
    const suggestionNote = document.getElementById('hudu-mapping-suggestion-102');
    expect(suggestionNote?.textContent).toContain('Suggested');
    expect(suggestionNote?.textContent).toContain('Exact name');
    expect(suggestionNote?.textContent).toContain('90%');
    expect(document.getElementById('hudu-mapping-suggestion-101')).toBeNull();
    expect(document.getElementById('hudu-mapping-suggestion-103')).toBeNull();
  });

  it('T051: selecting a client persists immediately and re-renders the row as Mapped', async () => {
    setHuduCompanyMappingMock.mockResolvedValue({ success: true, data: { mapping_id: 'map-new' } });

    await renderManager();

    fireEvent.change(screen.getByTestId('hudu-client-picker-103'), { target: { value: 'client-3' } });

    await waitFor(() => {
      expect(setHuduCompanyMappingMock).toHaveBeenCalledTimes(1);
    });
    expect(setHuduCompanyMappingMock).toHaveBeenCalledWith({
      clientId: 'client-3',
      huduCompanyId: 103,
      metadata: { hudu_company_name: 'Umbrella', id_in_integration: null, url: null },
    });

    await waitFor(() => {
      expect(document.getElementById('hudu-mapping-status-103')?.textContent).toBe('Mapped');
    });
    expect(document.getElementById('hudu-mapping-count-mapped')?.textContent).toBe('2 mapped');
    expect(document.getElementById('hudu-mapping-count-unmapped')?.textContent).toBe('0 unmapped');
    expect(clearHuduCompanyMappingMock).not.toHaveBeenCalled();
  });

  it('T051: clearing a mapped row calls clearHuduCompanyMapping and re-renders as Unmapped', async () => {
    clearHuduCompanyMappingMock.mockResolvedValue({ success: true, data: { cleared: 1 } });

    await renderManager();

    fireEvent.change(screen.getByTestId('hudu-client-picker-101'), { target: { value: '' } });

    await waitFor(() => {
      expect(clearHuduCompanyMappingMock).toHaveBeenCalledWith({ mappingId: 'map-1' });
    });
    await waitFor(() => {
      expect(document.getElementById('hudu-mapping-status-101')?.textContent).toBe('Unmapped');
    });
    expect(setHuduCompanyMappingMock).not.toHaveBeenCalled();
  });

  it('T051: a one-to-one conflict error surfaces as a destructive toast and the row stays unmapped', async () => {
    setHuduCompanyMappingMock.mockResolvedValue({
      success: false,
      error: 'Client is already mapped to a Hudu company.',
      code: 'client_already_mapped',
    });

    await renderManager();

    fireEvent.change(screen.getByTestId('hudu-client-picker-102'), { target: { value: 'client-1' } });

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: 'destructive',
          description:
            'That client is already mapped to another Hudu company. Clear the existing mapping first.',
        })
      );
    });
    expect(document.getElementById('hudu-mapping-status-102')?.textContent).toBe('Suggested');
    expect(document.getElementById('hudu-mapping-count-mapped')?.textContent).toBe('1 mapped');
  });

  it('T052: row badges show Mapped / Suggested / Unmapped with matching variants', async () => {
    await renderManager();

    const mapped = document.getElementById('hudu-mapping-status-101');
    const suggested = document.getElementById('hudu-mapping-status-102');
    const unmapped = document.getElementById('hudu-mapping-status-103');

    expect(mapped?.textContent).toBe('Mapped');
    expect(mapped?.getAttribute('data-variant')).toBe('success');
    expect(suggested?.textContent).toBe('Suggested');
    expect(suggested?.getAttribute('data-variant')).toBe('primary');
    expect(unmapped?.textContent).toBe('Unmapped');
    expect(unmapped?.getAttribute('data-variant')).toBe('warning');
  });

  it('T053: Refresh calls syncHuduCompanies then reloads, keeping confirmed mappings intact', async () => {
    syncHuduCompaniesMock.mockResolvedValue({
      success: true,
      data: { companies: [], fetched_at: '2026-06-09T01:00:00.000Z' },
    });

    await renderManager();
    expect(getHuduCompanyMappingsMock).toHaveBeenCalledTimes(1);

    // The refreshed list gains a company; the confirmed mapping row is untouched.
    const refreshed = buildCompanies();
    refreshed.push({
      hudu_company_id: 104,
      hudu_company_name: 'Soylent',
      id_in_integration: null,
      url: null,
      mapping: null,
      suggestion: null,
    });
    mockMappings(refreshed);

    fireEvent.click(screen.getByRole('button', { name: 'Refresh Companies' }));

    await screen.findByText('Soylent');
    expect(syncHuduCompaniesMock).toHaveBeenCalledTimes(1);
    expect(getHuduCompanyMappingsMock).toHaveBeenCalledTimes(2);

    // Sync ran before the reload.
    const syncOrder = syncHuduCompaniesMock.mock.invocationCallOrder[0];
    const reloadOrder = getHuduCompanyMappingsMock.mock.invocationCallOrder[1];
    expect(syncOrder).toBeLessThan(reloadOrder);

    // Confirmed mapping still rendered after the re-render.
    expect(document.getElementById('hudu-mapping-status-101')?.textContent).toBe('Mapped');
    expect((screen.getByTestId('hudu-client-picker-101') as HTMLSelectElement).value).toBe('client-1');
    expect(document.getElementById('hudu-mapping-count-total')?.textContent).toBe('4 total');
    expect(setHuduCompanyMappingMock).not.toHaveBeenCalled();
    expect(clearHuduCompanyMappingMock).not.toHaveBeenCalled();
  });

  it('T053: a failed refresh surfaces the error and does not reload', async () => {
    syncHuduCompaniesMock.mockResolvedValue({ success: false, error: 'HTTP 429' });

    await renderManager();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh Companies' }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('HTTP 429');
    });
    expect(getHuduCompanyMappingsMock).toHaveBeenCalledTimes(1);
  });
});
