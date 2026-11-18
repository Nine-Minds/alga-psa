import { describe, expect, it, vi } from 'vitest';
import type { AssetStatus } from '@alga-psa/types';

vi.mock('../../actions/assetStatusActions', () => ({
  listAssetStatuses: vi.fn(),
}));

const { buildAssetStatusOptions } = await import('./useAssetStatusOptions');
const { assetStatusLabel } = await import('../../lib/assetStatus');

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

  it('falls back to the six builtins while the registry is loading', () => {
    expect(buildAssetStatusOptions(null, t).map((option) => option.value))
      .toEqual(['active', 'in_stock', 'maintenance', 'held_by_msp', 'inactive', 'retired']);
  });

  it('keeps an archived status the asset already carries selectable', () => {
    const options = buildAssetStatusOptions([status({ slug: 'active' })], t, 'legacy_state');
    expect(options.map((option) => option.value)).toEqual(['active', 'legacy_state']);
  });

  it('does not duplicate the current status when it is already offered', () => {
    const options = buildAssetStatusOptions([status({ slug: 'active' })], t, 'active');
    expect(options.map((option) => option.value)).toEqual(['active']);
  });

  it('never offers an archived status', () => {
    // The edit form listed "Loaner QA" after it was archived; picking it was
    // then refused by the server with 'Status "Loaner QA" is archived'.
    const options = buildAssetStatusOptions([
      status({ slug: 'active' }),
      status({ slug: 'loaner_qa', label: 'Loaner QA', kind: 'pending', is_builtin: false, is_active: false }),
    ], t);
    expect(options.map((option) => option.value)).toEqual(['active']);
  });

  it('still shows the archived status an asset already sits on, by its label', () => {
    const options = buildAssetStatusOptions([
      status({ slug: 'active' }),
      status({ slug: 'loaner_qa', label: 'Loaner QA', kind: 'pending', is_builtin: false, is_active: false }),
    ], t, 'loaner_qa');
    expect(options.map((option) => option.value)).toEqual(['active', 'loaner_qa']);
    expect(options[1].label).toBe('Loaner QA');
  });
});

// A tenant that renames a builtin means it (FR-B4): translating the slug
// regardless kept showing "Active" after the rename, in every locale.
describe('renamed builtins', () => {
  it('shows the tenant label instead of the shipped translation', () => {
    const translate = (key: string, options?: Record<string, unknown>) =>
      key === 'assetStatuses.active' ? 'Aktiv' : String(options?.defaultValue ?? key);
    expect(assetStatusLabel(translate, 'active', [status({ slug: 'active', label: 'In service' })]))
      .toBe('In service');
    expect(assetStatusLabel(translate, 'active', [status({ slug: 'active', label: 'Active' })]))
      .toBe('Aktiv');
  });
});

// T030: every surface that prints a bare slug reads it through this resolver,
// so a custom status never shows as "in_repair".
describe('assetStatusLabel', () => {
  it('prefers the registry label for a custom status', () => {
    const label = assetStatusLabel(t, 'in_repair', [
      status({ slug: 'in_repair', label: 'Repair bench', kind: 'pending', is_builtin: false }),
    ]);
    expect(label).toBe('Repair bench');
  });

  it('humanizes a custom slug while the registry is still loading', () => {
    expect(assetStatusLabel(t, 'in_repair', null)).toBe('In repair');
  });

  it('keeps the builtin label for a builtin slug', () => {
    expect(assetStatusLabel(t, 'in_stock', null)).toBe('In stock');
  });

  it('renders nothing for an asset with no status', () => {
    expect(assetStatusLabel(t, null, null)).toBe('');
  });
});
