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
    skipEntraTenantMappingMock.mockResolvedValue({ data: { skipped: true } });

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

    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }));

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
