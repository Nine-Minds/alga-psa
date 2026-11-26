import { describe, expect, it } from 'vitest';
import { retainReadableAssetUpdateFields } from './assetFormPayload';

describe('retainReadableAssetUpdateFields', () => {
  it('omits defaults for masked base and extension fields while retaining readable edits and clears', () => {
    const authorizedRead = {
      asset_type: 'network_device',
      name: 'Switch',
      purchase_cost: null,
      network_device: { device_type: 'switch', port_count: 24 },
      attributes: { public_note: 'visible' },
    } as any;
    const serializedForm = {
      name: 'Renamed switch',
      warranty_end_date: '2026-12-31T00:00:00.000Z',
      purchase_cost: null,
      manufacturer: null,
      network_device: { device_type: 'switch', management_ip: '', port_count: null },
      attributes: { private_note: '', public_note: 'updated' },
    } as any;

    expect(retainReadableAssetUpdateFields(serializedForm, authorizedRead)).toEqual({
      name: 'Renamed switch',
      warranty_end_date: '2026-12-31T00:00:00.000Z',
      purchase_cost: null,
      network_device: { device_type: 'switch', port_count: null },
      attributes: { public_note: 'updated' },
    });
  });

  it('keeps a newly entered structured value that was absent because it was previously unset', () => {
    expect(retainReadableAssetUpdateFields(
      { attributes: { new_field: 'new value' } } as any,
      { attributes: {} } as any,
    )).toEqual({ attributes: { new_field: 'new value' } });
  });

  it('sends entered hardware fields for an asset created without a hardware row', () => {
    const receivedAsset = { asset_type: 'workstation', name: 'Received laptop' } as any;
    const serializedForm = {
      workstation: {
        os_type: 'windows', os_version: '', cpu_model: 'i7-1165G7', cpu_cores: null,
        ram_gb: 16, storage_type: '', storage_capacity_gb: null, gpu_model: '', installed_software: [],
      },
    } as any;

    expect(retainReadableAssetUpdateFields(serializedForm, receivedAsset, new Set(['workstation']))).toEqual({
      workstation: { os_type: 'windows', cpu_model: 'i7-1165G7', ram_gb: 16 },
    });
  });

  it('does not send untouched hardware defaults when no hardware row is readable', () => {
    const serializedForm = {
      name: 'Switch',
      network_device: { device_type: 'switch', management_ip: '', supports_poe: false, vlan_config: {} },
    } as any;

    expect(retainReadableAssetUpdateFields(serializedForm, { asset_type: 'network_device' } as any)).toEqual({
      name: 'Switch',
    });
  });
});
