/* @vitest-environment jsdom */

/**
 * Operator report: "contact should open in a drawer from asset details page,
 * not go to whole contact page and break navigation. and vice versa - asset
 * should open in a drawer from contact page."
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ContactDrawerContext } from '@alga-psa/ui';

import { AssetAssigneeRow } from './AssetAssigneeRow';
import { ContactAssetsSection } from './ContactAssetsSection';

const mockLoadDrawerData = vi.fn();
const mockGetContactAssignedAssets = vi.fn();
const mockGetContactSharedWorkspaces = vi.fn();

vi.mock('../actions/assetDrawerActions', () => ({
  loadAssetDetailDrawerData: (...args: unknown[]) => mockLoadDrawerData(...args),
}));
vi.mock('../actions/assetAssignmentActions', () => ({
  assignAssetContact: vi.fn(),
  getContactAssignedAssets: (...args: unknown[]) => mockGetContactAssignedAssets(...args),
}));
vi.mock('../actions/assetGroupActions', () => ({
  getContactSharedWorkspaces: (...args: unknown[]) => mockGetContactSharedWorkspaces(...args),
}));
vi.mock('../actions/clientLookupActions', () => ({
  getClientContactsForAssets: vi.fn(async () => []),
}));
vi.mock('./shared/useAssetStatusOptions', () => ({
  useAssetStatusRegistry: () => ({ statuses: [] }),
}));

/** Reports what the real drawer was asked to show. */
vi.mock('./AssetDetailDrawerClient', () => ({
  AssetDetailDrawerClient: ({ isOpen, selectedAssetId }: any) => (
    isOpen ? <div data-testid="asset-drawer">{selectedAssetId}</div> : null
  ),
}));

vi.mock('react-hot-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const stableT = (key: string, options?: Record<string, unknown>) => {
  let text = String(options?.defaultValue ?? key);
  for (const [name, value] of Object.entries(options ?? {})) {
    if (name === 'defaultValue') continue;
    text = text.replace(`{{${name}}}`, String(value));
  }
  return text;
};
const stableTranslation = { t: stableT };
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => stableTranslation }));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, variant: _v, size: _s, ...props }: any) => <button {...props}>{children}</button>,
}));
vi.mock('@alga-psa/ui/components/ContactPicker', () => ({
  ContactPicker: ({ id }: any) => <div id={id} />,
}));
vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ isOpen, children, id }: any) => (isOpen ? <div id={id}>{children}</div> : null),
  DialogContent: ({ children }: any) => <div>{children}</div>,
}));
vi.mock('@alga-psa/ui/components/bento', () => ({
  BentoTile: ({ children, id }: any) => <section id={id}>{children}</section>,
  BentoTileEmpty: ({ children, id }: any) => <div id={id}>{children}</div>,
}));

describe('asset ↔ contact drawers', () => {
  beforeEach(() => {
    mockLoadDrawerData.mockReset().mockResolvedValue({ data: { asset: { asset_id: 'a-1' } }, error: null });
    mockGetContactAssignedAssets.mockReset().mockResolvedValue([
      { assignment_id: 'as-1', asset_id: 'a-1', asset_name: 'Dorothy laptop', asset_type: 'workstation', asset_tag: 'OZ-1', asset_status: 'active' },
    ]);
    mockGetContactSharedWorkspaces.mockReset().mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
  });

  const assigneeRow = (contactDrawer?: { openContactDrawer: (id: string, options?: any) => void }) => (
    <ContactDrawerContext value={contactDrawer}>
      <AssetAssigneeRow
        assetId="a-1"
        clientId="c-1"
        contactNameId="contact-1"
        contactName="Dorothy Gale"
      />
    </ContactDrawerContext>
  );

  it('opens the assignee in the contact drawer instead of navigating', async () => {
    const openContactDrawer = vi.fn();
    render(assigneeRow({ openContactDrawer }));

    const link = document.getElementById('asset-assignee-link')!;
    expect(link.tagName).toBe('BUTTON');
    expect(link.getAttribute('href')).toBeNull();

    fireEvent.click(link);
    expect(openContactDrawer).toHaveBeenCalledWith('contact-1', expect.objectContaining({
      onChangesSaved: expect.any(Function),
    }));
  });

  it('still links to the contact page where no drawer is mounted', () => {
    render(assigneeRow(undefined));

    const link = document.getElementById('asset-assignee-link')!;
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe('/msp/contacts/contact-1');
  });

  it('opens an assigned asset in the asset drawer from the contact page', async () => {
    render(<ContactAssetsSection contactId="contact-1" />);

    const row = await waitFor(() => {
      const element = document.getElementById('contact-assets-asset-a-1');
      expect(element).toBeTruthy();
      return element!;
    });
    expect(row.tagName).toBe('BUTTON');
    fireEvent.click(row);

    await waitFor(() => expect(screen.getByTestId('asset-drawer').textContent).toBe('a-1'));
    expect(mockLoadDrawerData).toHaveBeenCalledWith({ assetId: 'a-1', panel: 'overview' });
  });
});
