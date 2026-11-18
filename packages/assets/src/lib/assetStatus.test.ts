import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ASSET_STATUSES, assetStatusKey, assetStatusLabel } from './assetStatus';

const LOCALES_DIR = resolve(__dirname, '../../../../server/public/locales');
const locales = readdirSync(LOCALES_DIR, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);

describe('asset status labels', () => {
  it('finds every locale directory (guards the loop below against vacuity)', () => {
    expect(locales).toEqual(expect.arrayContaining(['en', 'de', 'es', 'fr', 'it', 'nl', 'pl', 'pt', 'sv', 'xx', 'yy']));
  });

  it.each(locales)('%s has an assetStatuses key for every status in ASSET_STATUSES', (locale) => {
    const catalogue = JSON.parse(readFileSync(resolve(LOCALES_DIR, locale, 'msp/assets.json'), 'utf8'));
    const missing = ASSET_STATUSES.filter((status) => {
      const value = catalogue.assetStatuses?.[status];
      return typeof value !== 'string' || value.length === 0;
    });
    expect(missing).toEqual([]);
  });

  it('includes held_by_msp and reads it as "Held by MSP", not the slug', () => {
    expect(ASSET_STATUSES).toContain('held_by_msp');
    const en = JSON.parse(readFileSync(resolve(LOCALES_DIR, 'en/msp/assets.json'), 'utf8'));
    expect(en.assetStatuses.held_by_msp).toBe('Held by MSP');
    const t = (key: string) => (key === assetStatusKey('held_by_msp') ? en.assetStatuses.held_by_msp : key);
    expect(assetStatusLabel(t, 'held_by_msp')).toBe('Held by MSP');
  });

  it('humanizes only a slug the canonical list does not know, and never prints the raw slug', () => {
    const t = (_key: string, o?: Record<string, unknown>) => String(o?.defaultValue ?? _key);
    expect(assetStatusLabel(t, 'in_repair')).toBe('In repair');
    expect(assetStatusLabel(t, 'in_repair', [{ slug: 'in_repair', label: 'Being fixed' }])).toBe('Being fixed');
    expect(assetStatusLabel(t, null)).toBe('');
  });

  it('is the only status label implementation: no surface re-declares getAssetStatusLabel', () => {
    const surfaces = [
      'AssociatedAssets.tsx',
      'AssetDetails.tsx',
      'AssetDashboardClient.tsx',
      'QuickAddAsset.tsx',
      'ContactAssetsSection.tsx',
      'assetListCells.tsx',
    ];
    for (const file of surfaces) {
      const source = readFileSync(resolve(__dirname, '../components', file), 'utf8');
      expect(source, file).not.toMatch(/const getAssetStatusLabel\s*=\s*\(/);
      expect(source, file).not.toMatch(/associatedAssets\.assetStatuses|assetDetails\.statuses/);
    }
  });
});
