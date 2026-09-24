// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mergeEntraUserFilterConfig } from '@alga-psa/integrations/lib/entraUserFilterConfig';
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
type Override = Partial<typeof config>;
const mapping = { managedTenantId: 'managed-1' } as EntraConfirmedMapping;
let defaults = config;
let savedOverride: Override | null = null;
const group = (id: string, displayName: string) => ({ id, displayName });
const id = (key: string, groupId: string) => `entra-filter-${key}-managed-1-${groupId}`;

function renderPanel() {
  return render(<ManagedTenantUserFilterPanel mapping={mapping} />);
}
async function waitForPanel() {
  await waitFor(() => expect(document.getElementById('entra-filter-save-managed-1')).not.toBeNull());
}

describe('ManagedTenantUserFilterPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    defaults = config;
    savedOverride = null;
    getFilter.mockImplementation(async () => ({ success: true, data: { defaults, override: savedOverride, effective: mergeEntraUserFilterConfig(defaults, savedOverride) } }));
    listGroups.mockResolvedValue({ success: true, data: { groups: [group('group-all', 'All Users'), group('default-group', 'Tenant Exclusion'), group('own-group', 'Managed Exclusion')] } });
    updateFilter.mockImplementation(async ({ override }) => ({ success: true, data: { defaults, override, effective: mergeEntraUserFilterConfig(defaults, override) } }));
    runPreview.mockResolvedValue({ success: true, data: {} });
  });

  it('saves only the D1 recommendations and previews their merged policy when there is no override', async () => {
    defaults = { ...config, exclusionPatterns: ['tenant-pattern'], excludeGroupIds: ['default-group'] };
    renderPanel();
    await waitForPanel();
    expect((document.getElementById('entra-filter-memberUsersOnly-managed-1') as HTMLInputElement).checked).toBe(true);
    expect((document.getElementById('entra-filter-licensedUsersOnly-managed-1') as HTMLInputElement).checked).toBe(true);

    fireEvent.click(document.getElementById('entra-filter-preview-managed-1') as HTMLButtonElement);
    await waitFor(() => expect(runPreview).toHaveBeenCalledTimes(1));
    const previewConfig = runPreview.mock.calls[0][0].userFilterConfig;
    fireEvent.click(document.getElementById('entra-filter-save-managed-1') as HTMLButtonElement);
    await waitFor(() => expect(updateFilter).toHaveBeenCalledTimes(1));
    expect(updateFilter.mock.calls[0][0].override).toEqual({ memberUsersOnly: true, licensedUsersOnly: true });
    expect(mergeEntraUserFilterConfig(defaults, updateFilter.mock.calls[0][0].override)).toEqual(previewConfig);
    expect((document.getElementById('entra-filter-licensedUsersOnly-managed-1') as HTMLInputElement).checked).toBe(true);
  });

  it('preserves an existing sparse override and does not copy tenant-default exclusions when editing a key', async () => {
    defaults = { ...config, exclusionPatterns: ['tenant-pattern'], excludeGroupIds: ['default-group'] };
    savedOverride = { licensedUsersOnly: false, exclusionPatterns: ['managed-pattern'], excludeGroupIds: ['own-group'] };
    renderPanel();
    await waitForPanel();
    fireEvent.click(document.getElementById('entra-filter-memberUsersOnly-managed-1') as HTMLInputElement);
    fireEvent.click(document.getElementById('entra-filter-save-managed-1') as HTMLButtonElement);
    await waitFor(() => expect(updateFilter).toHaveBeenCalledTimes(1));
    expect(updateFilter.mock.calls[0][0].override).toEqual({
      licensedUsersOnly: false,
      exclusionPatterns: ['managed-pattern'],
      excludeGroupIds: ['own-group'],
      memberUsersOnly: true,
    });
    expect(updateFilter.mock.calls[0][0].override.excludeGroupIds).not.toContain('default-group');
    expect(updateFilter.mock.calls[0][0].override.exclusionPatterns).not.toContain('tenant-pattern');
  });

  it('allows an override-owned excluded group to be unchecked in Preview and Save', async () => {
    defaults = { ...config, excludeGroupIds: ['default-group'] };
    savedOverride = { excludeGroupIds: ['own-group'] };
    renderPanel();
    await waitForPanel();
    fireEvent.click(document.getElementById(id('excludeGroupIds', 'own-group')) as HTMLInputElement);
    expect((document.getElementById(id('excludeGroupIds', 'own-group')) as HTMLInputElement).checked).toBe(false);
    fireEvent.click(document.getElementById('entra-filter-preview-managed-1') as HTMLButtonElement);
    await waitFor(() => expect(runPreview).toHaveBeenCalledTimes(1));
    expect(runPreview.mock.calls[0][0].userFilterConfig.excludeGroupIds).toEqual(['default-group']);
    fireEvent.click(document.getElementById('entra-filter-save-managed-1') as HTMLButtonElement);
    await waitFor(() => expect(updateFilter).toHaveBeenCalledTimes(1));
    expect(updateFilter.mock.calls[0][0].override.excludeGroupIds).toEqual([]);
  });

  it('keeps a tenant-default exclusion checked and disabled', async () => {
    defaults = { ...config, excludeGroupIds: ['default-group'] };
    renderPanel();
    await waitForPanel();
    const checkbox = document.getElementById(id('excludeGroupIds', 'default-group')) as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    expect(checkbox.disabled).toBe(true);
    expect(checkbox.parentElement?.textContent).toMatch(/inherited/i);
    fireEvent.click(document.getElementById('entra-filter-preview-managed-1') as HTMLButtonElement);
    await waitFor(() => expect(runPreview).toHaveBeenCalledTimes(1));
    expect(runPreview.mock.calls[0][0].userFilterConfig.excludeGroupIds).toEqual(['default-group']);
    fireEvent.click(document.getElementById('entra-filter-save-managed-1') as HTMLButtonElement);
    await waitFor(() => expect(updateFilter).toHaveBeenCalledTimes(1));
    expect(updateFilter.mock.calls[0][0].override).toEqual({ memberUsersOnly: true, licensedUsersOnly: true });
  });

  it('shows the broad-group warning for a pending unsaved All Users selection', async () => {
    renderPanel();
    await waitForPanel();
    fireEvent.click(document.getElementById(id('includeGroupIds', 'group-all')) as HTMLInputElement);
    expect(document.getElementById('entra-filter-broad-group-warning')).not.toBeNull();
    expect(updateFilter).not.toHaveBeenCalled();
  });
});
