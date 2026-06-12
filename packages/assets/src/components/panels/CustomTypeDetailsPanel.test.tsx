/* @vitest-environment jsdom */

/**
 * T315 (F312): asset detail renders the custom type's schema fields as a
 * read-only panel (kind-aware values), and renders nothing for built-ins,
 * unregistered slugs, empty schemas, or all-absent values.
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

import { CustomTypeDetailsPanel } from './CustomTypeDetailsPanel';

const mockGetAssetTypes = vi.fn();

vi.mock('../../actions/assetTypeRegistryActions', () => ({
  getAssetTypes: (...args: unknown[]) => mockGetAssetTypes(...args),
}));

vi.mock('@alga-psa/ui/components/Card', () => ({
  Card: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  CardHeader: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  CardTitle: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  CardContent: ({ children, ...props }: any) => <div {...props}>{children}</div>,
}));

const stableT = (key: string, options?: Record<string, unknown>) => {
  let text = String(options?.defaultValue ?? key);
  for (const [name, value] of Object.entries(options ?? {})) {
    if (name === 'defaultValue') continue;
    text = text.replace(`{{${name}}}`, String(value));
  }
  return text;
};
const stableTranslation = { t: stableT };

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => stableTranslation,
}));

function baseAsset(assetType: string, attributes?: Record<string, unknown>) {
  return {
    asset_id: 'asset-1',
    asset_type: assetType,
    client_id: 'client-1',
    asset_tag: 'tag-1',
    name: 'Door 42',
    status: 'active',
    created_at: '2026-06-12T00:00:00Z',
    updated_at: '2026-06-12T00:00:00Z',
    tenant: 'tenant-1',
    attributes,
  } as any;
}

const doorAccessType = {
  tenant: 'tenant-1',
  type_id: 'type-1',
  slug: 'door_access',
  name: 'Door Access System',
  icon: null,
  fields_schema: [
    { key: 'vendor', label: 'Vendor', kind: 'text' },
    { key: 'door_count', label: 'Door Count', kind: 'number' },
    { key: 'install_date', label: 'Install Date', kind: 'date' },
    { key: 'controller_tier', label: 'Controller Tier', kind: 'select', options: ['Basic', 'Pro'] },
    { key: 'admin_portal', label: 'Admin Portal', kind: 'url' },
    { key: 'cloud_managed', label: 'Cloud Managed', kind: 'boolean' },
    { key: 'badge_format', label: 'Badge Format', kind: 'text' },
  ],
  is_builtin: false,
  display_order: 0,
  created_at: '2026-06-12T00:00:00Z',
  updated_at: '2026-06-12T00:00:00Z',
};

const builtinWorkstationType = {
  ...doorAccessType,
  type_id: 'type-2',
  slug: 'workstation',
  name: 'Workstation',
  is_builtin: true,
};

describe('CustomTypeDetailsPanel (T315)', () => {
  beforeEach(() => {
    mockGetAssetTypes.mockReset();
    mockGetAssetTypes.mockResolvedValue([doorAccessType, builtinWorkstationType]);
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the schema read panel with kind-aware values for a custom-type asset', async () => {
    render(
      <CustomTypeDetailsPanel
        asset={baseAsset('door_access', {
          vendor: 'Acme Security',
          door_count: 12,
          install_date: '2026-01-31',
          controller_tier: 'Pro',
          admin_portal: 'https://doors.example.com/admin',
          cloud_managed: true,
          // badge_format intentionally absent — its row must be skipped.
          hudu_fields: [{ label: 'Ignored', value: 'namespace data' }],
        })}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Door Access System Details')).toBeTruthy();
    });

    // text
    expect(screen.getByText('Vendor:')).toBeTruthy();
    expect(screen.getByText('Acme Security')).toBeTruthy();
    // number -> text
    expect(screen.getByText('12')).toBeTruthy();
    // date -> locale date (parsed as local midnight, so the day never shifts)
    expect(
      screen.getByText(new Date('2026-01-31T00:00:00').toLocaleDateString())
    ).toBeTruthy();
    // select -> text
    expect(screen.getByText('Pro')).toBeTruthy();
    // url -> link
    const link = screen.getByText('https://doors.example.com/admin') as HTMLAnchorElement;
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe('https://doors.example.com/admin');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    // boolean -> Yes/No
    expect(screen.getByText('Yes')).toBeTruthy();
    // absent value -> row skipped
    expect(screen.queryByText('Badge Format:')).toBeNull();
    // stable row ids
    expect(document.getElementById('custom-type-details-card')).toBeTruthy();
    expect(document.getElementById('custom-type-field-vendor')).toBeTruthy();
  });

  it('renders boolean false as No and a non-http url as plain text', async () => {
    render(
      <CustomTypeDetailsPanel
        asset={baseAsset('door_access', {
          cloud_managed: false,
          admin_portal: 'javascript:alert(1)',
        })}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('No')).toBeTruthy();
    });
    const value = screen.getByText('javascript:alert(1)');
    expect(value.tagName).not.toBe('A');
  });

  it('renders nothing for a built-in asset and never fetches the registry', () => {
    const { container } = render(
      <CustomTypeDetailsPanel asset={baseAsset('workstation', { vendor: 'irrelevant' })} />
    );
    expect(container.innerHTML).toBe('');
    expect(mockGetAssetTypes).not.toHaveBeenCalled();
  });

  it('renders nothing for an unregistered custom slug', async () => {
    const { container } = render(
      <CustomTypeDetailsPanel asset={baseAsset('mystery_thing', { vendor: 'x' })} />
    );
    await waitFor(() => expect(mockGetAssetTypes).toHaveBeenCalled());
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when the custom type has an empty schema', async () => {
    mockGetAssetTypes.mockResolvedValue([{ ...doorAccessType, fields_schema: [] }]);
    const { container } = render(
      <CustomTypeDetailsPanel asset={baseAsset('door_access', { vendor: 'x' })} />
    );
    await waitFor(() => expect(mockGetAssetTypes).toHaveBeenCalled());
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when every schema value is absent or blank', async () => {
    const { container } = render(
      <CustomTypeDetailsPanel
        asset={baseAsset('door_access', { vendor: '   ', door_count: null })}
      />
    );
    await waitFor(() => expect(mockGetAssetTypes).toHaveBeenCalled());
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when attributes are missing entirely', async () => {
    const { container } = render(
      <CustomTypeDetailsPanel asset={baseAsset('door_access', undefined)} />
    );
    await waitFor(() => expect(mockGetAssetTypes).toHaveBeenCalled());
    expect(container.innerHTML).toBe('');
  });
});
