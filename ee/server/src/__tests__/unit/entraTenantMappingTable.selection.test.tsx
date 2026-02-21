// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EntraTenantMappingTable } from '@ee/components/settings/integrations/EntraTenantMappingTable';

const {
  getEntraMappingPreviewMock,
  confirmEntraMappingsMock,
  skipEntraTenantMappingMock,
  importEntraTenantAsClientMock,
  getAllClientsMock,
} = vi.hoisted(() => ({
  getEntraMappingPreviewMock: vi.fn(),
  confirmEntraMappingsMock: vi.fn(),
  skipEntraTenantMappingMock: vi.fn(),
  importEntraTenantAsClientMock: vi.fn(),
  getAllClientsMock: vi.fn(),
}));

vi.mock('@alga-psa/integrations/actions', () => ({
  getEntraMappingPreview: getEntraMappingPreviewMock,
  confirmEntraMappings: confirmEntraMappingsMock,
  skipEntraTenantMapping: skipEntraTenantMappingMock,
  importEntraTenantAsClient: importEntraTenantAsClientMock,
}));

vi.mock('@alga-psa/clients/actions', () => ({
  getAllClients: getAllClientsMock,
}));

vi.mock('@alga-psa/ui/components/Badge', () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock('@alga-psa/ui/components/ClientPicker', () => ({
  __esModule: true,
  ClientPicker: ({
    id,
    clients = [],
    selectedClientId,
    onSelect,
    placeholder,
  }: {
    id: string;
    clients?: Array<{ client_id?: string; id?: string; client_name?: string; name?: string }>;
    selectedClientId?: string | null;
    onSelect: (value: string | null) => void;
    placeholder?: string;
  }) => (
    <select
      id={id}
      data-testid={`client-picker-${id}`}
      value={selectedClientId || ''}
      onChange={(event) => onSelect(event.target.value || null)}
    >
      <option value="">{placeholder ?? 'Select client...'}</option>
      {clients.map((client) => (
        <option key={client.client_id || client.id} value={client.client_id || client.id}>
          {client.client_name || client.name}
        </option>
      ))}
    </select>
  ),
}));

describe('EntraTenantMappingTable client selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    confirmEntraMappingsMock.mockResolvedValue({
      success: true,
      data: { confirmedMappings: 1 },
    });
    skipEntraTenantMappingMock.mockResolvedValue({ data: { skipped: true } });
    importEntraTenantAsClientMock.mockResolvedValue({
      success: true,
      data: { clientId: 'client-import-default', managedTenantId: 'managed-import-default' },
    });
  });

  it('T059: supports selecting candidate clients for fuzzy and unmatched rows', async () => {
    getEntraMappingPreviewMock.mockResolvedValue({
      data: {
        autoMatched: [],
        fuzzyCandidates: [
          {
            managedTenantId: 'managed-fuzzy',
            entraTenantId: 'entra-fuzzy',
            displayName: 'Fuzzy Tenant',
            primaryDomain: null,
            sourceUserCount: 7,
            candidates: [
              {
                clientId: 'client-alpha',
                clientName: 'Alpha MSP',
                confidenceScore: 0.76,
                reason: 'fuzzy_name',
              },
            ],
          },
        ],
        unmatched: [
          {
            managedTenantId: 'managed-unmatched',
            entraTenantId: 'entra-unmatched',
            displayName: 'Unmatched Tenant',
            primaryDomain: null,
            sourceUserCount: 3,
          },
        ],
      },
    });
    getAllClientsMock.mockResolvedValue([
      { client_id: 'client-alpha', client_name: 'Alpha MSP' },
      { client_id: 'client-beta', client_name: 'Beta MSP' },
    ]);

    const onSummaryChange = vi.fn();
    render(<EntraTenantMappingTable onSummaryChange={onSummaryChange} />);

    await screen.findByText('Fuzzy Tenant');
    await screen.findByText('Unmatched Tenant');

    const fuzzyRow = screen.getByText('Fuzzy Tenant').closest('tr');
    const unmatchedRow = screen.getByText('Unmatched Tenant').closest('tr');
    expect(fuzzyRow).toBeTruthy();
    expect(unmatchedRow).toBeTruthy();

    const fuzzySelect = within(fuzzyRow as HTMLElement).getByRole('combobox') as HTMLSelectElement;
    const unmatchedSelect = within(unmatchedRow as HTMLElement).getByRole('combobox') as HTMLSelectElement;

    fireEvent.change(fuzzySelect, { target: { value: 'client-alpha' } });
    fireEvent.change(unmatchedSelect, { target: { value: 'client-beta' } });

    expect(fuzzySelect.value).toBe('client-alpha');
    expect(unmatchedSelect.value).toBe('client-beta');

    await waitFor(() => {
      expect(onSummaryChange).toHaveBeenCalledWith(
        expect.objectContaining({
          mapped: 2,
        })
      );
    });
  });

  it('T061: bulk preselect marks exact auto matches as selected pending confirm', async () => {
    getEntraMappingPreviewMock.mockResolvedValue({
      data: {
        autoMatched: [
          {
            managedTenantId: 'managed-auto-1',
            entraTenantId: 'entra-auto-1',
            displayName: 'Auto Tenant One',
            primaryDomain: 'one.example.com',
            sourceUserCount: 5,
            match: {
              clientId: 'client-one',
              clientName: 'Client One',
              confidenceScore: 1,
              reason: 'exact_domain',
            },
          },
          {
            managedTenantId: 'managed-auto-2',
            entraTenantId: 'entra-auto-2',
            displayName: 'Auto Tenant Two',
            primaryDomain: 'two.example.com',
            sourceUserCount: 8,
            match: {
              clientId: 'client-two',
              clientName: 'Client Two',
              confidenceScore: 1,
              reason: 'exact_domain',
            },
          },
        ],
        fuzzyCandidates: [],
        unmatched: [],
      },
    });
    getAllClientsMock.mockResolvedValue([
      { client_id: 'client-one', client_name: 'Client One' },
      { client_id: 'client-two', client_name: 'Client Two' },
    ]);

    render(<EntraTenantMappingTable />);

    await screen.findByText('Auto Tenant One');
    await screen.findByText('Auto Tenant Two');

    fireEvent.click(screen.getByRole('button', { name: 'Preselect Exact Matches' }));

    const rowOne = screen.getByText('Auto Tenant One').closest('tr') as HTMLElement;
    const rowTwo = screen.getByText('Auto Tenant Two').closest('tr') as HTMLElement;
    const selectOne = within(rowOne).getByRole('combobox') as HTMLSelectElement;
    const selectTwo = within(rowTwo).getByRole('combobox') as HTMLSelectElement;

    expect(selectOne.value).toBe('client-one');
    expect(selectTwo.value).toBe('client-two');
  });

  it('T130: importing an unmapped tenant updates status badge to Imported rather than Auto-matched', async () => {
    getEntraMappingPreviewMock.mockResolvedValue({
      data: {
        autoMatched: [],
        fuzzyCandidates: [],
        unmatched: [
          {
            managedTenantId: 'managed-unmapped-130',
            entraTenantId: 'entra-unmapped-130',
            displayName: 'Unmapped Import Tenant',
            primaryDomain: 'tenant130.unmapped.example.invalid',
            sourceUserCount: 3,
          },
        ],
      },
    });
    getAllClientsMock
      .mockResolvedValueOnce([{ client_id: 'client-existing', client_name: 'Existing Client' }])
      .mockResolvedValueOnce([
        { client_id: 'client-existing', client_name: 'Existing Client' },
        { client_id: 'client-imported-130', client_name: 'Unmapped Import Tenant' },
      ]);
    importEntraTenantAsClientMock.mockResolvedValue({
      success: true,
      data: { managedTenantId: 'managed-unmapped-130', clientId: 'client-imported-130' },
    });

    render(<EntraTenantMappingTable />);

    await screen.findByText('Unmapped Import Tenant');
    const initialRow = screen.getByText('Unmapped Import Tenant').closest('tr') as HTMLElement;
    expect(within(initialRow).getByText('Unmatched')).toBeTruthy();

    fireEvent.click(within(initialRow).getByRole('button', { name: 'Import as new client' }));

    await waitFor(() => {
      expect(importEntraTenantAsClientMock).toHaveBeenCalledWith({
        managedTenantId: 'managed-unmapped-130',
      });
    });

    await waitFor(() => {
      const updatedRow = screen.getByText('Unmapped Import Tenant').closest('tr') as HTMLElement;
      expect(within(updatedRow).getByText('Imported')).toBeTruthy();
      expect(within(updatedRow).queryByText('Auto-matched')).toBeNull();
      const updatedSelect = within(updatedRow).getByRole('combobox') as HTMLSelectElement;
      expect(updatedSelect.value).toBe('client-imported-130');
    });
  });

  it('T131: confirming selected mappings persists manual unmatched selections', async () => {
    getEntraMappingPreviewMock.mockResolvedValue({
      data: {
        autoMatched: [],
        fuzzyCandidates: [],
        unmatched: [
          {
            managedTenantId: 'managed-unmatched-131',
            entraTenantId: 'entra-unmatched-131',
            displayName: 'Unmatched Confirm Tenant',
            primaryDomain: 'unmatched131.example.invalid',
            sourceUserCount: 2,
          },
        ],
      },
    });
    getAllClientsMock.mockResolvedValue([
      { client_id: 'client-131', client_name: 'Client 131' },
    ]);
    confirmEntraMappingsMock.mockResolvedValue({
      success: true,
      data: { confirmedMappings: 1 },
    });

    render(<EntraTenantMappingTable />);

    await screen.findByText('Unmatched Confirm Tenant');
    const row = screen.getByText('Unmatched Confirm Tenant').closest('tr') as HTMLElement;
    const select = within(row).getByRole('combobox') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'client-131' } });

    const confirmButton = screen.getByRole('button', { name: 'Confirm Selected Mappings' });
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(confirmEntraMappingsMock).toHaveBeenCalledWith({
        mappings: [
          expect.objectContaining({
            managedTenantId: 'managed-unmatched-131',
            clientId: 'client-131',
            mappingState: 'mapped',
          }),
        ],
      });
    });
  });

  it('T065: summary counters reflect mapped, skipped, and needs-review totals after row changes', async () => {
    getEntraMappingPreviewMock.mockResolvedValue({
      data: {
        autoMatched: [
          {
            managedTenantId: 'managed-auto-65',
            entraTenantId: 'entra-auto-65',
            displayName: 'Auto 65',
            primaryDomain: 'auto65.example.com',
            sourceUserCount: 1,
            match: {
              clientId: 'client-auto-65',
              clientName: 'Auto Client 65',
              confidenceScore: 1,
              reason: 'exact_domain',
            },
          },
        ],
        fuzzyCandidates: [
          {
            managedTenantId: 'managed-review-65',
            entraTenantId: 'entra-review-65',
            displayName: 'Review 65',
            primaryDomain: null,
            sourceUserCount: 1,
            candidates: [
              {
                clientId: 'client-review-65',
                clientName: 'Review Client 65',
                confidenceScore: 0.72,
                reason: 'fuzzy_name',
              },
            ],
          },
        ],
        unmatched: [],
      },
    });
    getAllClientsMock.mockResolvedValue([
      { client_id: 'client-auto-65', client_name: 'Auto Client 65' },
      { client_id: 'client-review-65', client_name: 'Review Client 65' },
    ]);

    const onSummaryChange = vi.fn();
    render(<EntraTenantMappingTable onSummaryChange={onSummaryChange} />);

    await screen.findByText('Auto 65');
    await screen.findByText('Review 65');

    await waitFor(() => {
      expect(onSummaryChange).toHaveBeenCalledWith(
        expect.objectContaining({
          mapped: 1,
          skipped: 0,
          needsReview: 1,
        })
      );
    });

    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));

    await waitFor(() => {
      expect(onSummaryChange).toHaveBeenCalledWith(
        expect.objectContaining({
          mapped: 1,
          skipped: 1,
          needsReview: 0,
        })
      );
    });
  });
});
