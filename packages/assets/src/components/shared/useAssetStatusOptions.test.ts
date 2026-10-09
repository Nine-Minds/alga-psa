import { describe, expect, it, vi } from 'vitest';
import type { AssetStatus } from '@alga-psa/types';

vi.mock('../../actions/assetStatusActions', () => ({
  listAssetStatuses: vi.fn(),
}));

const { buildAssetStatusOptions } = await import('./useAssetStatusOptions');

const t = (key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key);

const status = (overrides: Partial<AssetStatus>): AssetStatus => ({
  tenant: 't',
  status_id: overrides.slug ?? 'id',
  slug: 'active',
  label: 'Active',
  kind: 'deployable',
  is_builtin: true,
  is_active: true,
  display_order: 0,
  created_at: '',
  updated_at: '',
  ...overrides,
});

// T030: options come from the registry; nothing is hardcoded in the form.
describe('buildAssetStatusOptions', () => {
  it('lists the registry statuses in kind order', () => {
    const options = buildAssetStatusOptions([
      status({ slug: 'retired', label: 'Retired', kind: 'archived' }),
      status({ slug: 'in_repair', label: 'In repair', kind: 'pending', is_builtin: false }),
      status({ slug: 'active', label: 'Active', kind: 'deployable' }),
    ], t);
    expect(options.map((option) => option.value)).toEqual(['active', 'in_repair', 'retired']);
    expect(options[1].label).toBe('In repair');
  });

  it('falls back to the five builtins while the registry is loading', () => {
    expect(buildAssetStatusOptions(null, t).map((option) => option.value))
      .toEqual(['active', 'in_stock', 'maintenance', 'inactive', 'retired']);
  });

  it('keeps an archived status the asset already carries selectable', () => {
    const options = buildAssetStatusOptions([status({ slug: 'active' })], t, 'legacy_state');
    expect(options.map((option) => option.value)).toEqual(['active', 'legacy_state']);
  });

  it('does not duplicate the current status when it is already offered', () => {
    const options = buildAssetStatusOptions([status({ slug: 'active' })], t, 'active');
    expect(options.map((option) => option.value)).toEqual(['active']);
  });
});
