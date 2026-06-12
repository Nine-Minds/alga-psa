/* @vitest-environment jsdom */

/**
 * T316 (F313): dashboard by-type breakdown shows counts for custom types
 * with registry-resolved labels (not raw slugs), keeps built-in labels, and
 * forwards chip clicks to the type filter.
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { AssetTypeBreakdownCard } from './AssetTypeBreakdownCard';
import { resolveAssetTypeLabel } from '../lib/assetTypeDisplay';

const mockGetAssetCountsByType = vi.fn();

vi.mock('../actions/assetStatisticsActions', () => ({
  getAssetCountsByType: (...args: unknown[]) => mockGetAssetCountsByType(...args),
}));

vi.mock('@alga-psa/ui/components/Card', () => ({
  Card: ({ children, ...props }: any) => <div {...props}>{children}</div>,
}));

vi.mock('@alga-psa/ui/ui-reflection/withDataAutomationId', () => ({
  withDataAutomationId: ({ id }: { id: string }) => ({ id, 'data-automation-id': id }),
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

const registry = [
  {
    tenant: 'tenant-1',
    type_id: 'type-1',
    slug: 'door_access',
    name: 'Door Access System',
    icon: null,
    fields_schema: [],
    is_builtin: false,
    display_order: 0,
    created_at: '2026-06-12T00:00:00Z',
    updated_at: '2026-06-12T00:00:00Z',
  },
];

// Mirrors the dashboard's resolver: built-ins keep their labels, custom
// slugs resolve through the registry, unknown slugs title-case.
const getTypeLabel = (slug: string) =>
  slug === 'workstation' ? 'Workstation' : resolveAssetTypeLabel(registry, slug);

describe('AssetTypeBreakdownCard (T316)', () => {
  beforeEach(() => {
    mockGetAssetCountsByType.mockReset();
    mockGetAssetCountsByType.mockResolvedValue({
      workstation: 7,
      door_access: 3,
      mystery_thing: 1,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('shows registry labels (not raw slugs) for custom types alongside built-ins', async () => {
    render(<AssetTypeBreakdownCard getTypeLabel={getTypeLabel} />);

    await waitFor(() => {
      expect(screen.getByText('Door Access System')).toBeTruthy();
    });
    expect(screen.getByText('Workstation')).toBeTruthy();
    expect(screen.getByText('7')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
    // Unregistered slug keeps the historical fallback, never the raw slug.
    expect(screen.getByText('Mystery Thing')).toBeTruthy();
    expect(screen.queryByText('door_access')).toBeNull();
    // Stable, slug-keyed ids.
    expect(document.getElementById('asset-type-breakdown-door_access')).toBeTruthy();
  });

  it('forwards chip clicks to the type filter and marks active types', async () => {
    const onSelectType = vi.fn();
    render(
      <AssetTypeBreakdownCard
        getTypeLabel={getTypeLabel}
        onSelectType={onSelectType}
        activeTypes={['workstation']}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Door Access System')).toBeTruthy();
    });

    await userEvent.click(screen.getByText('Door Access System'));
    expect(onSelectType).toHaveBeenCalledWith('door_access');

    const activeChip = document.getElementById('asset-type-breakdown-workstation');
    expect(activeChip?.className).toContain('border-primary-300');
  });

  it('refetches when refreshToken changes and hides itself with zero assets', async () => {
    mockGetAssetCountsByType.mockResolvedValue({});
    const { container, rerender } = render(
      <AssetTypeBreakdownCard getTypeLabel={getTypeLabel} refreshToken={0} />
    );

    await waitFor(() => expect(mockGetAssetCountsByType).toHaveBeenCalledTimes(1));
    expect(container.innerHTML).toBe('');

    rerender(<AssetTypeBreakdownCard getTypeLabel={getTypeLabel} refreshToken={1} />);
    await waitFor(() => expect(mockGetAssetCountsByType).toHaveBeenCalledTimes(2));
  });
});
