// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EntraTenantMappingTable } from '@ee/components/settings/integrations/EntraTenantMappingTable';

const {
  getEntraMappingPreviewMock,
  confirmEntraMappingsMock,
  listEntraMappingGroupsMock,
  getAllClientsMock,
} = vi.hoisted(() => ({
  getEntraMappingPreviewMock: vi.fn(),
  confirmEntraMappingsMock: vi.fn(),
  listEntraMappingGroupsMock: vi.fn(),
  getAllClientsMock: vi.fn(),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', async () => {
  const { createLocaleTranslationMock } = await import('../utils/localeTranslationMock');
  return createLocaleTranslationMock('msp/integrations');
});

vi.mock('@alga-psa/integrations/actions', () => ({
  getEntraMappingPreview: getEntraMappingPreviewMock,
  confirmEntraMappings: confirmEntraMappingsMock,
  listEntraMappingGroups: listEntraMappingGroupsMock,
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
    listEntraMappingGroupsMock.mockResolvedValue({ success: true, data: { groups: [] } });
  });

  // Each row now carries three selects (client, entitlement group, provisioning
  // mode), so the client picker has to be addressed by id rather than by role.
  const clientPickerIn = (row: HTMLElement, managedTenantId: string): HTMLSelectElement =>
    within(row).getByTestId(
      `client-picker-entra-client-picker-${managedTenantId}`
    ) as HTMLSelectElement;

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

    // Re-query between the two changes: the table re-renders on the first
    // selection, so a node captured beforehand can be detached by the second.
    const pickerIn = (label: string, managedTenantId: string) =>
      clientPickerIn(screen.getByText(label).closest('tr') as HTMLElement, managedTenantId);

    fireEvent.change(pickerIn('Fuzzy Tenant', 'managed-fuzzy'), {
      target: { value: 'client-alpha' },
    });
    fireEvent.change(pickerIn('Unmatched Tenant', 'managed-unmatched'), {
      target: { value: 'client-beta' },
    });

    expect(pickerIn('Fuzzy Tenant', 'managed-fuzzy').value).toBe('client-alpha');
    expect(pickerIn('Unmatched Tenant', 'managed-unmatched').value).toBe('client-beta');

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
    const selectOne = clientPickerIn(rowOne, 'managed-auto-1');
    const selectTwo = clientPickerIn(rowTwo, 'managed-auto-2');

    expect(selectOne.value).toBe('client-one');
    expect(selectTwo.value).toBe('client-two');
  });

  it('T144: create-new is provisional until the reviewed decisions are confirmed', async () => {
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
    getAllClientsMock.mockResolvedValue([
      { client_id: 'client-existing', client_name: 'Existing Client' },
    ]);

    render(<EntraTenantMappingTable />);

    await screen.findByText('Unmapped Import Tenant');
    const initialRow = screen.getByText('Unmapped Import Tenant').closest('tr') as HTMLElement;
    expect(within(initialRow).getByText('Unmatched')).toBeTruthy();

    fireEvent.click(within(initialRow).getByRole('button', { name: 'Import as new client' }));

    const reviewedRow = screen.getByText('Unmapped Import Tenant').closest('tr') as HTMLElement;
    expect(within(reviewedRow).getAllByText('Import as new client').length).toBeGreaterThan(0);
    expect(confirmEntraMappingsMock).not.toHaveBeenCalled();
    expect(getAllClientsMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Confirm Selected Mappings' }));
    await waitFor(() => {
      expect(confirmEntraMappingsMock).toHaveBeenCalledWith({
        mappings: [
          expect.objectContaining({
            managedTenantId: 'managed-unmapped-130',
            clientId: null,
            mappingState: 'create_new',
          }),
        ],
      });
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
    const select = clientPickerIn(row, 'managed-unmatched-131');
    fireEvent.change(select, { target: { value: 'client-131' } });

    const modeSelect = row.querySelector(
      '#entra-provisioning-mode-managed-unmatched-131'
    ) as HTMLSelectElement | null;
    expect(modeSelect).toBeTruthy();
    fireEvent.change(modeSelect as HTMLSelectElement, { target: { value: 'workflow_managed' } });

    const confirmButton = screen.getByRole('button', { name: 'Confirm Selected Mappings' });
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(confirmEntraMappingsMock).toHaveBeenCalledWith({
        mappings: [
          expect.objectContaining({
            managedTenantId: 'managed-unmatched-131',
            clientId: 'client-131',
            mappingState: 'mapped',
            clientPortalEntraProvisioningMode: 'workflow_managed',
            clientPortalDefaultRoleName: null,
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

    const reviewRow = screen.getByText('Review 65').closest('tr') as HTMLElement;
    fireEvent.click(within(reviewRow).getByRole('button', { name: 'Skip' }));

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

  it('T022: selecting a broad entitlement group warns that every enabled user becomes eligible', async () => {
    getEntraMappingPreviewMock.mockResolvedValue({
      data: {
        autoMatched: [],
        fuzzyCandidates: [],
        unmatched: [
          {
            managedTenantId: 'managed-warning-22',
            entraTenantId: 'entra-warning-22',
            displayName: 'Warning Tenant',
            primaryDomain: null,
            sourceUserCount: 9,
          },
        ],
      },
    });
    getAllClientsMock.mockResolvedValue([{ client_id: 'client-22', client_name: 'Client 22' }]);
    listEntraMappingGroupsMock.mockResolvedValue({
      success: true,
      data: {
        groups: [
          { id: 'group-all-users', displayName: 'All Users' },
          { id: 'group-limited', displayName: 'Project Team' },
        ],
      },
    });

    render(<EntraTenantMappingTable />);
    await screen.findByText('Warning Tenant');

    const row = screen.getByText('Warning Tenant').closest('tr') as HTMLElement;
    fireEvent.change(clientPickerIn(row, 'managed-warning-22'), {
      target: { value: 'client-22' },
    });

    // Re-query between steps: loading the groups re-renders the table, so a node
    // captured beforehand is detached by the time the change would fire on it.
    const groupSelect = () =>
      document.querySelector(
        '#entra-entitlement-group-managed-warning-22'
      ) as HTMLSelectElement;
    expect(groupSelect()).toBeTruthy();

    fireEvent.focus(groupSelect());
    await waitFor(() => {
      expect(listEntraMappingGroupsMock).toHaveBeenCalledWith({
        managedTenantId: 'managed-warning-22',
      });
    });
    await waitFor(() => {
      expect(groupSelect().querySelector('option[value="group-all-users"]')).toBeTruthy();
    });
    fireEvent.change(groupSelect(), { target: { value: 'group-all-users' } });

    await waitFor(() => {
      expect(
        screen.getByText(
          'Warning: every enabled user in this Entra group will be eligible for client portal access.'
        )
      ).toBeTruthy();
    });
  });

  it('restores saved client portal provisioning overrides and re-confirms them unchanged', async () => {
    getEntraMappingPreviewMock.mockResolvedValue({
      data: {
        autoMatched: [
          {
            managedTenantId: 'managed-saved-override',
            entraTenantId: 'entra-saved-override',
            displayName: 'Saved Override Tenant',
            primaryDomain: 'saved.example.com',
            sourceUserCount: 4,
            mappingState: 'mapped',
            mappedClientId: 'client-saved',
            existingMapping: {
              clientId: 'client-saved',
              mappingState: 'mapped',
              clientPortalEntraProvisioningMode: 'disabled',
              clientPortalEntitlementGroupId: 'group-saved',
              clientPortalDefaultRoleName: 'Finance',
            },
            match: {
              clientId: 'client-other',
              clientName: 'Other Client',
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
      { client_id: 'client-saved', client_name: 'Saved Client' },
      { client_id: 'client-other', client_name: 'Other Client' },
    ]);

    render(<EntraTenantMappingTable />);

    await screen.findByText('Saved Override Tenant');
    const row = screen.getByText('Saved Override Tenant').closest('tr') as HTMLElement;
    expect(clientPickerIn(row, 'managed-saved-override').value).toBe('client-saved');
    expect(
      (row.querySelector('#entra-provisioning-mode-managed-saved-override') as HTMLSelectElement)
        .value
    ).toBe('disabled');
    expect(
      (row.querySelector('#entra-entitlement-group-managed-saved-override') as HTMLSelectElement)
        .value
    ).toBe('group-saved');
    expect(
      (row.querySelector('#entra-default-role-managed-saved-override') as HTMLInputElement).value
    ).toBe('Finance');

    fireEvent.click(screen.getByRole('button', { name: 'Confirm Selected Mappings' }));

    await waitFor(() => {
      expect(confirmEntraMappingsMock).toHaveBeenCalledWith({
        mappings: [
          expect.objectContaining({
            managedTenantId: 'managed-saved-override',
            clientId: 'client-saved',
            clientPortalEntraProvisioningMode: 'disabled',
            clientPortalEntitlementGroupId: 'group-saved',
            clientPortalDefaultRoleName: 'Finance',
          }),
        ],
      });
    });
  });
});
