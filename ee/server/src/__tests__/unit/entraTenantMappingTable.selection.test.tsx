// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EntraTenantMappingTable } from '@ee/components/settings/integrations/EntraTenantMappingTable';

const {
  getEntraMappingPreviewMock,
  skipEntraTenantMappingMock,
  getAllClientsMock,
} = vi.hoisted(() => ({
  getEntraMappingPreviewMock: vi.fn(),
  skipEntraTenantMappingMock: vi.fn(),
  getAllClientsMock: vi.fn(),
}));

vi.mock('@alga-psa/integrations/actions', () => ({
  getEntraMappingPreview: getEntraMappingPreviewMock,
  skipEntraTenantMapping: skipEntraTenantMappingMock,
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

describe('EntraTenantMappingTable client selection', () => {
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
    skipEntraTenantMappingMock.mockResolvedValue({ data: { skipped: true } });

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
    skipEntraTenantMappingMock.mockResolvedValue({ data: { skipped: true } });

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
});
