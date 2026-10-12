import { describe, expect, it } from 'vitest';
import { portalAssetStatusLabel, portalAssetStatusVariant } from './portalAssetStatus';

/** The portal's `t`: returns the locale string when it has one, else the default. */
function translator(dictionary: Record<string, string>) {
  return (key: string, options?: Record<string, unknown>) =>
    dictionary[key] ?? (options?.defaultValue as string | undefined) ?? key;
}

describe('portalAssetStatusLabel', () => {
  const t = translator({
    'assets.statuses.active': 'Aktiv',
    'assets.statuses.inactive': 'Inaktiv',
    'assets.statuses.maintenance': 'In Wartung',
  });

  it('reads a builtin slug as its localized label', () => {
    expect(portalAssetStatusLabel(t, 'active')).toBe('Aktiv');
    expect(portalAssetStatusLabel(t, 'maintenance')).toBe('In Wartung');
  });

  it('reads a tenant status as its humanized slug, never as "Active"', () => {
    expect(portalAssetStatusLabel(t, 'in_repair')).toBe('In repair');
    expect(portalAssetStatusLabel(t, 'awaiting_parts')).toBe('Awaiting parts');
  });

  it('falls back to the builtin English label when the locale lacks the key', () => {
    expect(portalAssetStatusLabel(translator({}), 'in_stock')).toBe('In stock');
  });

  it('is empty for a missing status rather than showing a key', () => {
    expect(portalAssetStatusLabel(t, null)).toBe('');
    expect(portalAssetStatusLabel(t, undefined)).toBe('');
  });
});

describe('portalAssetStatusVariant', () => {
  it('tones a deployable status well and a spent one muted', () => {
    expect(portalAssetStatusVariant('active')).toBe('success');
    expect(portalAssetStatusVariant('in_stock')).toBe('success');
    expect(portalAssetStatusVariant('inactive')).toBe('default-muted');
    expect(portalAssetStatusVariant('retired')).toBe('default-muted');
  });

  it('tones pending and tenant statuses as something to ask about', () => {
    expect(portalAssetStatusVariant('maintenance')).toBe('warning');
    expect(portalAssetStatusVariant('in_repair')).toBe('warning');
    expect(portalAssetStatusVariant(null)).toBe('warning');
  });
});
