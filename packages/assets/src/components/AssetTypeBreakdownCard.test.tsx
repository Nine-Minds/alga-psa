/* @vitest-environment jsdom */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { AssetTypeBreakdownCard } from './AssetTypeBreakdownCard';
import { resolveAssetTypeLabel } from '../lib/assetTypeDisplay';

vi.mock('@alga-psa/ui/components/Card', () => ({
  Card: ({ children, ...props }: any) => <div {...props}>{children}</div>,
}));

vi.mock('@alga-psa/ui/ui-reflection/withDataAutomationId', () => ({
  withDataAutomationId: ({ id }: { id: string }) => ({ id, 'data-automation-id': id }),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
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

const getTypeLabel = (slug: string) =>
  slug === 'workstation' ? 'Workstation' : resolveAssetTypeLabel(registry, slug);

describe('AssetTypeBreakdownCard', () => {
  afterEach(cleanup);

  it('shows registry labels and the counts supplied with the asset list', () => {
    render(
      <AssetTypeBreakdownCard
        getTypeLabel={getTypeLabel}
        counts={{ workstation: 7, door_access: 3, mystery_thing: 1 }}
      />
    );

    expect(screen.getByText('Door Access System')).toBeTruthy();
    expect(screen.getByText('Workstation')).toBeTruthy();
    expect(screen.getByText('7')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByText('Mystery Thing')).toBeTruthy();
    expect(screen.queryByText('door_access')).toBeNull();
    expect(document.getElementById('asset-type-breakdown-door_access')).toBeTruthy();
  });

  it('forwards chip clicks and marks active types', async () => {
    const onSelectType = vi.fn();
    render(
      <AssetTypeBreakdownCard
        getTypeLabel={getTypeLabel}
        counts={{ workstation: 7, door_access: 3 }}
        onSelectType={onSelectType}
        activeTypes={['workstation']}
      />
    );

    await userEvent.click(screen.getByText('Door Access System'));
    expect(onSelectType).toHaveBeenCalledWith('door_access');
    expect(document.getElementById('asset-type-breakdown-workstation')?.className)
      .toContain('border-primary-300');
  });

  it('shows loading, hides an empty result, and renders new counts', () => {
    const { container, rerender } = render(
      <AssetTypeBreakdownCard getTypeLabel={getTypeLabel} counts={null} />
    );
    expect(container.querySelector('.skeleton-fill')).toBeTruthy();

    rerender(<AssetTypeBreakdownCard getTypeLabel={getTypeLabel} counts={{}} />);
    expect(container.innerHTML).toBe('');

    rerender(<AssetTypeBreakdownCard getTypeLabel={getTypeLabel} counts={{ door_access: 2 }} />);
    expect(screen.getByText('Door Access System')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
  });

  it('keeps a selected type visible at zero when other filters exclude it', () => {
    render(
      <AssetTypeBreakdownCard
        getTypeLabel={getTypeLabel}
        counts={{ workstation: 4 }}
        activeTypes={['door_access']}
      />
    );

    const chip = document.getElementById('asset-type-breakdown-door_access');
    expect(chip?.textContent).toContain('0');
    expect(chip?.className).toContain('border-primary-300');
  });

  it('keeps a selected custom type whose slug matches an object property', () => {
    render(
      <AssetTypeBreakdownCard
        getTypeLabel={getTypeLabel}
        counts={{}}
        activeTypes={['constructor']}
      />
    );

    expect(document.getElementById('asset-type-breakdown-constructor')?.textContent).toContain('0');
  });
});
