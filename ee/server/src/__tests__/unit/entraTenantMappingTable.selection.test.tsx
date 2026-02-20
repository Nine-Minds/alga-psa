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
});
