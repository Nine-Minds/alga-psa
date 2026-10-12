import { describe, expect, it } from 'vitest';
import {
  portalAssetStatusLabel,
  portalAssetStatusVariant,
  tallyPortalDeviceStatuses,
} from './portalAssetStatus';

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

  it('prefers the tenant label the caller read from the registry', () => {
    // A status renamed after creation ("in_repair" -> "At the depot") must read
    // as the tenant wrote it, not as its humanized slug.
    expect(portalAssetStatusLabel(t, 'in_repair', 'At the depot')).toBe('At the depot');
    expect(portalAssetStatusLabel(t, 'in_repair', '   ')).toBe('In repair');
    // A locale that translates a builtin still wins over the tenant's label.
    expect(portalAssetStatusLabel(t, 'active', 'In use')).toBe('Aktiv');
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

  it('follows the kind the tenant gave a status when the caller knows it', () => {
    expect(portalAssetStatusVariant('on_loan', 'deployable')).toBe('success');
    expect(portalAssetStatusVariant('written_off', 'archived')).toBe('default-muted');
    expect(portalAssetStatusVariant('in_repair', 'pending')).toBe('warning');
  });
});

describe('tallyPortalDeviceStatuses', () => {
  it('does not call a device in a tenant status active', () => {
    // The banner said "All devices active" for this exact fleet, because
    // "in_repair" is not the literal `inactive`.
    const tally = tallyPortalDeviceStatuses([
      { slug: 'active', kind: 'deployable', count: 3 },
      { slug: 'in_repair', kind: 'pending', count: 1 },
    ]);
    expect(tally.deviceCount).toBe(4);
    expect(tally.activeCount).toBe(3);
    expect(tally.allActive).toBe(false);
    expect(tally.attention.map((summary) => summary.slug)).toEqual(['in_repair']);
  });

  it('counts every deployable status as active, not just the one named active', () => {
    const tally = tallyPortalDeviceStatuses([
      { slug: 'active', kind: 'deployable', count: 2 },
      { slug: 'on_loan', kind: 'deployable', count: 1 },
    ]);
    expect(tally.activeCount).toBe(3);
    expect(tally.allActive).toBe(true);
    expect(tally.attention).toEqual([]);
  });

  it('claims nothing for a client with no devices', () => {
    const tally = tallyPortalDeviceStatuses([]);
    expect(tally).toEqual({ deviceCount: 0, activeCount: 0, allActive: false, attention: [] });
  });

  it('keeps retired and inactive devices out of the active count', () => {
    const tally = tallyPortalDeviceStatuses([
      { slug: 'inactive', kind: 'undeployable', count: 2 },
      { slug: 'retired', kind: 'archived', count: 1 },
    ]);
    expect(tally.activeCount).toBe(0);
    expect(tally.attention).toHaveLength(2);
  });
});
