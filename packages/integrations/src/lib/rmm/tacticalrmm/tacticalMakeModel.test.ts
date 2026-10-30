import { describe, expect, it } from 'vitest';
import { buildTacticalAssetIdentityPatch, extractHardware, extractTacticalMakeModel } from './deviceSync';

// T010: make/model reach assets.manufacturer / assets.model from either
// Tactical payload shape.
describe('extractTacticalMakeModel', () => {
  it('reads Manufacturer and Model out of wmi_detail.comp_sys', () => {
    expect(extractTacticalMakeModel({
      plat: 'windows',
      wmi_detail: { comp_sys: [[{ Manufacturer: 'LENOVO' }, { Model: '20XW004PUS' }]] },
    })).toEqual({ manufacturer: 'LENOVO', model: '20XW004PUS' });
  });

  it('falls back to the list endpoint make_model string', () => {
    expect(extractTacticalMakeModel({ plat: 'windows', make_model: 'Dell Inc. Latitude 5420' }))
      .toEqual({ manufacturer: null, model: 'Dell Inc. Latitude 5420' });
  });

  it('strips a known make prefix from the combined string', () => {
    expect(extractTacticalMakeModel({
      plat: 'windows',
      make_model: 'Dell Inc. Latitude 5420',
      wmi_detail: { comp_sys: [[{ Manufacturer: 'Dell Inc.' }]] },
    })).toEqual({ manufacturer: 'Dell Inc.', model: 'Latitude 5420' });
  });

  it('reads the posix shape', () => {
    expect(extractTacticalMakeModel({
      plat: 'linux',
      wmi_detail: { manufacturer: 'Apple Inc.', model: 'MacBookPro18,3' },
    })).toEqual({ manufacturer: 'Apple Inc.', model: 'MacBookPro18,3' });
  });

  it('drops OEM placeholder values', () => {
    expect(extractTacticalMakeModel({
      plat: 'windows',
      wmi_detail: { comp_sys: [[{ Manufacturer: 'System manufacturer' }, { Model: 'To Be Filled By O.E.M.' }]] },
    })).toEqual({ manufacturer: null, model: null });
  });

  it('returns nulls when the payload carries nothing', () => {
    expect(extractTacticalMakeModel({})).toEqual({ manufacturer: null, model: null });
  });
});

describe('extractHardware make/model', () => {
  it('exposes make and model alongside the other hardware facts', () => {
    const hardware = extractHardware({
      plat: 'windows',
      wmi_detail: { comp_sys: [[{ Manufacturer: 'HP' }, { Model: 'EliteBook 840' }]] },
    });
    expect(hardware.manufacturer).toBe('HP');
    expect(hardware.model).toBe('EliteBook 840');
  });
});

describe('buildTacticalAssetIdentityPatch', () => {
  it('omits empty values so a thin payload never blanks a filled column', () => {
    expect(buildTacticalAssetIdentityPatch({
      cpu_model: null,
      cpu_cores: null,
      ram_gb: null,
      disk_usage: null,
      serial_number: null,
      last_reboot_at: null,
      manufacturer: null,
      model: null,
    })).toEqual({});
  });

  it('includes the values the payload carried', () => {
    expect(buildTacticalAssetIdentityPatch({
      cpu_model: null,
      cpu_cores: null,
      ram_gb: null,
      disk_usage: null,
      serial_number: null,
      last_reboot_at: null,
      manufacturer: 'HP',
      model: 'EliteBook 840',
    })).toEqual({ manufacturer: 'HP', model: 'EliteBook 840' });
  });
});
