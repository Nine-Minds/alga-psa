import { describe, expect, it } from 'vitest';
import { buildDefaultAssetExtension, buildDefaultAssetSeeds, hasDefaultAssetExtension } from './assetDefaultMetadata';

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
      gpu_model: '',
      installed_software: [],
    });
  });

  it('normalizes legacy dropdown text and preserves numeric values', () => {
    const ext = buildDefaultAssetExtension('workstation', {
      os_type: '  Windows  ',
      os_version: '   ',
      cpu_cores: 8,
      storage_type: 'SSD',
      ram_gb: '32',
      gpu_model: 'RTX 5070',
    })!;
    expect(ext.os_type).toBe('windows');
    expect(ext.os_version).toBe('');
    expect(ext.cpu_cores).toBe(8);
    expect(ext.ram_gb).toBe(32);
    expect(ext.storage_type).toBe('ssd');
    expect(ext.gpu_model).toBe('RTX 5070');
  });

  it('validates the network device type against the schema enum', () => {
    const ok = buildDefaultAssetExtension('network_device', { device_type: 'firewall', management_ip: '10.0.0.1' })!;
    expect(ok.device_type).toBe('firewall');
    expect(ok.management_ip).toBe('10.0.0.1');
    expect(() => buildDefaultAssetExtension('network_device', { device_type: 'toaster' })).toThrow('device_type');
  });

  it('honours the mobile supervision flag and printer model', () => {
    expect(buildDefaultAssetExtension('mobile_device', { is_supervised: true, model: 'iPhone 17' })!).toMatchObject({
      is_supervised: true,
      model: 'iPhone 17',
    });
    expect(buildDefaultAssetExtension('printer', { model: 'M479' })).toMatchObject({ model: 'M479' });
  });

  it('routes Model to the base assets row for types without a model column', () => {
    const { base, extension } = buildDefaultAssetSeeds('workstation', { model: 'OptiPlex 7020', os_type: 'Windows' });
    expect(base).toEqual({ model: 'OptiPlex 7020' });
    // The workstation extension table has no model column; the parsed payload
    // must stay model-free or the create call would carry a stray key.
    expect(extension).not.toHaveProperty('model');
    expect(buildDefaultAssetSeeds('server', { model: 'PowerEdge R660' }).base).toEqual({ model: 'PowerEdge R660' });
    expect(buildDefaultAssetSeeds('network_device', { model: 'SG-2400' })).toEqual({
      base: { model: 'SG-2400' },
      extension: expect.objectContaining({ device_type: 'switch' }),
    });
  });

  it('routes Model into the extension for mobile devices and printers', () => {
    const mobile = buildDefaultAssetSeeds('mobile_device', { model: 'iPhone 17' });
    expect(mobile.base).toEqual({});
    expect(mobile.extension).toMatchObject({ model: 'iPhone 17' });
    const printer = buildDefaultAssetSeeds('printer', { model: 'M479' });
    expect(printer.base).toEqual({});
    expect(printer.extension).toMatchObject({ model: 'M479' });
  });

  it('leaves the base model unset when the product has no model default', () => {
    expect(buildDefaultAssetSeeds('workstation', null).base).toEqual({});
    expect(buildDefaultAssetSeeds('workstation', { model: '   ' }).base).toEqual({});
  });

  it('covers the server extension shape', () => {
    expect(buildDefaultAssetExtension('server', { os_type: 'Linux' })).toEqual({
      os_type: 'linux',
      os_version: '',
      cpu_model: '',
      cpu_cores: null,
      ram_gb: null,
      storage_config: [],
      raid_config: '',
      is_virtual: false,
      hypervisor: '',
      network_interfaces: [],
      primary_ip: '',
      installed_services: [],
    });
  });

  it.each([
    ['workstation', { cpu_cores: 'not a number' }],
    ['workstation', { ram_gb: -1 }],
    ['server', { cpu_cores: 1.5 }],
    ['printer', { supports_color: 'no' }],
  ])('rejects invalid %s specs before delivery', (type, metadata) => {
    expect(() => buildDefaultAssetExtension(type, metadata)).toThrow('Invalid default asset spec');
  });

  it('keeps network, server, mobile, and printer fields with their original types', () => {
    expect(buildDefaultAssetExtension('network_device', {
      port_count: 24, supports_poe: true, power_draw_watts: 123.45,
    })).toMatchObject({ port_count: 24, supports_poe: true, power_draw_watts: 123.45 });
    expect(buildDefaultAssetExtension('server', {
      is_virtual: true, hypervisor: 'Hyper-V', raid_config: 'RAID 10', primary_ip: '10.0.0.2', ram_gb: 64,
    })).toMatchObject({ is_virtual: true, hypervisor: 'Hyper-V', raid_config: 'RAID 10', primary_ip: '10.0.0.2', ram_gb: 64 });
    expect(buildDefaultAssetExtension('mobile_device', {
      os_type: 'iOS', imei: '12345', phone_number: '5550100', carrier: 'Example',
    })).toMatchObject({ os_type: 'ios', imei: '12345', phone_number: '5550100', carrier: 'Example' });
    expect(buildDefaultAssetExtension('printer', {
      supports_color: true, supports_duplex: 'false', monthly_duty_cycle: '10000', ip_address: '10.0.0.3',
    })).toMatchObject({ supports_color: true, supports_duplex: false, monthly_duty_cycle: 10000, ip_address: '10.0.0.3' });
  });
});
