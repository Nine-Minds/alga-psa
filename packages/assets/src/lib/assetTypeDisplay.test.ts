import { describe, expect, it } from 'vitest';
import type { AssetTypeRegistryEntry } from '@alga-psa/types';
import { fallbackAssetTypeLabel, resolveAssetTypeLabel } from './assetTypeDisplay';

function entry(overrides: Partial<AssetTypeRegistryEntry>): AssetTypeRegistryEntry {
  return {
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
    ...overrides,
  };
}

describe('assetTypeDisplay (T317, F314)', () => {
  describe('fallbackAssetTypeLabel', () => {
    it('title-cases slug segments like the historical inline fallback', () => {
      expect(fallbackAssetTypeLabel('door_access')).toBe('Door Access');
      expect(fallbackAssetTypeLabel('workstation')).toBe('Workstation');
      expect(fallbackAssetTypeLabel('mystery_thing_v2')).toBe('Mystery Thing V2');
    });

    it('handles empty and degenerate slugs gracefully', () => {
      expect(fallbackAssetTypeLabel('')).toBe('');
      expect(fallbackAssetTypeLabel('_')).toBe('');
    });
  });

  describe('resolveAssetTypeLabel', () => {
    it('returns the registry display name for a matching custom slug', () => {
      const registry = [entry({})];
      expect(resolveAssetTypeLabel(registry, 'door_access')).toBe('Door Access System');
    });

    it('returns the registry name for built-in entries too (tenant renames)', () => {
      const registry = [entry({ slug: 'workstation', name: 'PC', is_builtin: true })];
      expect(resolveAssetTypeLabel(registry, 'workstation')).toBe('PC');
    });

    it('falls back to the title-cased slug for an unregistered slug', () => {
      const registry = [entry({})];
      expect(resolveAssetTypeLabel(registry, 'mystery_thing')).toBe('Mystery Thing');
    });

    it('falls back when the registry is null, undefined, or empty', () => {
      expect(resolveAssetTypeLabel(null, 'door_access')).toBe('Door Access');
      expect(resolveAssetTypeLabel(undefined, 'door_access')).toBe('Door Access');
      expect(resolveAssetTypeLabel([], 'door_access')).toBe('Door Access');
    });

    it('falls back when the matched entry has a blank name', () => {
      const registry = [entry({ name: '   ' })];
      expect(resolveAssetTypeLabel(registry, 'door_access')).toBe('Door Access');
    });
  });
});
