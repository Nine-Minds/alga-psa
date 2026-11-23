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
});
