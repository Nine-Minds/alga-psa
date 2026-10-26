import { describe, expect, it } from 'vitest';
import type { AssetStatus } from '@alga-psa/types';
import {
  ASSET_STATUS_KINDS,
  BUILTIN_ASSET_STATUSES,
  assetStatusKindForSlug,
  generateAssetStatusSlug,
  groupAssetStatusesByKind,
} from './assetStatusSchema';

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

// T021 / T027 companion: slug generation is what makes "In repair" unique.
describe('generateAssetStatusSlug', () => {
  it('slugifies a label the way the builtins are slugged', () => {
    expect(generateAssetStatusSlug('In repair')).toBe('in_repair');
    expect(generateAssetStatusSlug('In stock')).toBe('in_stock');
  });

  it('collapses punctuation and trims separators', () => {
    expect(generateAssetStatusSlug('  Awaiting — parts!  ')).toBe('awaiting_parts');
  });

  it('returns an empty slug for a label with no letters or digits', () => {
    expect(generateAssetStatusSlug('   ---  ')).toBe('');
  });
});

describe('BUILTIN_ASSET_STATUSES', () => {
  it('matches the six slugs the migration seeds, with their kinds', () => {
    expect(BUILTIN_ASSET_STATUSES.map((s) => [s.slug, s.kind])).toEqual([
      ['active', 'deployable'],
      ['in_stock', 'deployable'],
      ['maintenance', 'pending'],
      ['inactive', 'undeployable'],
      ['retired', 'archived'],
      ['held_by_msp', 'pending'],
    ]);
  });

  it('only uses kinds the CHECK constraint allows', () => {
    for (const builtin of BUILTIN_ASSET_STATUSES) {
      expect(ASSET_STATUS_KINDS).toContain(builtin.kind);
    }
  });
});

// FR-B5: what a surface is allowed to call "deployed" when all it holds is a slug.
describe('assetStatusKindForSlug', () => {
  const rows = [
    status({ slug: 'on_loan', kind: 'deployable', is_builtin: false }),
    status({ slug: 'in_repair', kind: 'pending', is_builtin: false }),
  ];

  it('reads the kind the tenant gave the status', () => {
    expect(assetStatusKindForSlug('on_loan', rows)).toBe('deployable');
    expect(assetStatusKindForSlug('in_repair', rows)).toBe('pending');
  });

  it('falls back to the builtin kind when the registry has not loaded', () => {
    expect(assetStatusKindForSlug('active', null)).toBe('deployable');
    expect(assetStatusKindForSlug('maintenance', [])).toBe('pending');
    expect(assetStatusKindForSlug('retired', undefined)).toBe('archived');
  });

  it('never calls an unexplained slug deployable', () => {
    expect(assetStatusKindForSlug('in_repair', null)).toBe('undeployable');
    expect(assetStatusKindForSlug('', rows)).toBe('undeployable');
  });
});

// T030: the form select groups by kind, in kind order, skipping empty groups.
describe('groupAssetStatusesByKind', () => {
  it('groups in lifecycle order and drops empty groups', () => {
    const grouped = groupAssetStatusesByKind([
      status({ slug: 'retired', kind: 'archived' }),
      status({ slug: 'in_repair', kind: 'pending', is_builtin: false }),
      status({ slug: 'active', kind: 'deployable' }),
    ]);
    expect(grouped.map((group) => group.kind)).toEqual(['deployable', 'pending', 'archived']);
    expect(grouped[1].statuses.map((s) => s.slug)).toEqual(['in_repair']);
  });

  it('returns nothing for an empty list', () => {
    expect(groupAssetStatusesByKind([])).toEqual([]);
  });
});
