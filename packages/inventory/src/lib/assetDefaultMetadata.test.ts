import { describe, expect, it } from 'vitest';
import { buildDefaultAssetExtension, hasDefaultAssetExtension } from './assetDefaultMetadata';

describe('buildDefaultAssetExtension', () => {
  it('returns null for non-built-in asset types and empty metadata', () => {
    expect(buildDefaultAssetExtension('unknown', null)).toBeNull();
    expect(buildDefaultAssetExtension('custom_type', { os_type: 'Windows' })).toBeNull();
    expect(hasDefaultAssetExtension('unknown')).toBe(false);
    expect(hasDefaultAssetExtension('workstation')).toBe(true);
  });

  it('fills every required workstation column when no metadata is stored', () => {
    expect(buildDefaultAssetExtension('workstation', null)).toEqual({
      os_type: '',
      os_version: '',
      cpu_model: '',
      cpu_cores: null,
      ram_gb: null,
      storage_type: '',
      storage_capacity_gb: null,
      installed_software: [],
    });
  });

  it('merges stored text values over the fill and ignores junk', () => {
    const ext = buildDefaultAssetExtension('workstation', {
      os_type: '  Windows  ',
      os_version: '   ',
      cpu_cores: 8, // numeric fields are not overridable from the product form
    })!;
    expect(ext.os_type).toBe('Windows');
    expect(ext.os_version).toBe('');
    expect(ext.cpu_cores).toBeNull();
  });

  it('validates the network device type against the schema enum', () => {
    const ok = buildDefaultAssetExtension('network_device', { device_type: 'firewall', management_ip: '10.0.0.1' })!;
    expect(ok.device_type).toBe('firewall');
    expect(ok.management_ip).toBe('10.0.0.1');
    const bad = buildDefaultAssetExtension('network_device', { device_type: 'toaster' })!;
    expect(bad.device_type).toBe('switch');
  });

  it('honours the mobile supervision flag and printer model', () => {
    expect(buildDefaultAssetExtension('mobile_device', { is_supervised: true, model: 'iPhone 17' })!).toMatchObject({
      is_supervised: true,
      model: 'iPhone 17',
    });
    expect(buildDefaultAssetExtension('printer', { model: 'M479' })).toMatchObject({ model: 'M479' });
  });

  it('covers the server extension shape', () => {
    expect(buildDefaultAssetExtension('server', { os_type: 'Linux' })).toEqual({
      os_type: 'Linux',
      os_version: '',
      cpu_model: '',
      cpu_cores: null,
      ram_gb: null,
      storage_config: [],
      is_virtual: false,
      network_interfaces: [],
      installed_services: [],
    });
  });
});
