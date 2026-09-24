// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ManagedTenantUserFilterPanel } from '@ee/components/settings/integrations/entra/ManagedTenantUserFilterPanel';
import type { EntraConfirmedMapping } from '@alga-psa/integrations/actions';

const { getFilter, listGroups, updateFilter, runPreview } = vi.hoisted(() => ({
  getFilter: vi.fn(), listGroups: vi.fn(), updateFilter: vi.fn(), runPreview: vi.fn(),
}));
vi.mock('@alga-psa/integrations/actions', () => ({
  getEntraManagedTenantUserFilter: getFilter,
  listEntraMappingGroups: listGroups,
  updateEntraManagedTenantUserFilter: updateFilter,
  runEntraPreflight: runPreview,
}));
vi.mock('@alga-psa/ui/lib/i18n/client', async () => {
  const { createLocaleTranslationMock } = await import('../utils/localeTranslationMock');
  return createLocaleTranslationMock('msp/integrations');
});
vi.mock('@ee/components/settings/integrations/entra/ContactPreflightReport', () => ({ ContactPreflightReport: () => null }));

const config = { version: 1 as const, memberUsersOnly: false, licensedUsersOnly: false, includeGroupIds: [] as string[], excludeGroupIds: [] as string[], exclusionPatterns: [] as string[], deactivateExcludedContacts: false };
const mapping = { managedTenantId: 'managed-1' } as EntraConfirmedMapping;

describe('ManagedTenantUserFilterPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getFilter.mockResolvedValue({ success: true, data: { override: null, effective: config } });
    listGroups.mockResolvedValue({ success: true, data: { groups: [{ id: 'group-all', displayName: 'All Users' }] } });
    updateFilter.mockImplementation(async ({ override }) => ({ success: true, data: { override, effective: override ?? config } }));
    runPreview.mockResolvedValue({ success: true, data: {} });
  });

  it('saves the same pending policy that Preview submits with no edits and with an edited key', async () => {
    const view = render(<ManagedTenantUserFilterPanel mapping={mapping} />);
    await waitFor(() => expect(document.getElementById('entra-filter-save-managed-1')).not.toBeNull());

    fireEvent.click(document.getElementById('entra-filter-save-managed-1') as HTMLButtonElement);
    await waitFor(() => expect(updateFilter).toHaveBeenCalledTimes(1));
    fireEvent.click(document.getElementById('entra-filter-preview-managed-1') as HTMLButtonElement);
    await waitFor(() => expect(runPreview).toHaveBeenCalledTimes(1));
    expect(updateFilter.mock.calls[0][0].override).toEqual(runPreview.mock.calls[0][0].userFilterConfig);

    fireEvent.click(document.getElementById('entra-filter-memberUsersOnly-managed-1') as HTMLInputElement);
    fireEvent.click(document.getElementById('entra-filter-save-managed-1') as HTMLButtonElement);
    await waitFor(() => expect(updateFilter).toHaveBeenCalledTimes(2));
    fireEvent.click(document.getElementById('entra-filter-preview-managed-1') as HTMLButtonElement);
    await waitFor(() => expect(runPreview).toHaveBeenCalledTimes(2));
    expect(updateFilter.mock.calls[1][0].override).toEqual(runPreview.mock.calls[1][0].userFilterConfig);
    expect(runPreview.mock.calls[1][0].userFilterConfig.memberUsersOnly).toBe(true);
    view.unmount();
  });

  it('shows the broad group warning as soon as the pending selection changes', async () => {
    render(<ManagedTenantUserFilterPanel mapping={mapping} />);
    await waitFor(() => expect(document.getElementById('entra-filter-includeGroupIds-managed-1-group-all')).not.toBeNull());
    fireEvent.click(document.getElementById('entra-filter-includeGroupIds-managed-1-group-all') as HTMLInputElement);
    expect(document.getElementById('entra-filter-broad-group-warning')).not.toBeNull();
  });
});
