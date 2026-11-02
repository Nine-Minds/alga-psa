import { describe, expect, it } from 'vitest';
import { projectAssetReadFields } from './projectAssetReadFields';

describe('projectAssetReadFields', () => {
  const response = {
    asset_id: 'a1', name: 'Server', serial_number: 'BASE-SECRET', vendor_id: 'v1', vendor_name: 'Secret Vendor',
    client: { client_id: 'c1', client_name: 'Visible Client' },
    attributes: { hudu_fields: { password: 'JSON-SECRET', public: 'visible' } },
    workstation: { serial_number: 'EXT-SECRET', cpu_cores: 8 },
    relationships: [{ name: 'Related device secret', child_asset_id: 'a2' }],
  };

  it('removes base, nested extension, JSON attribute and derived alias paths without changing visible fields', () => {
    expect(projectAssetReadFields(response, [
      'assets.serial_number', 'workstation.serial_number', 'attributes.hudu_fields.password',
      'vendor_id', 'relationships.name',
    ])).toEqual({
      asset_id: 'a1', name: 'Server', vendor_name: undefined,
      client: { client_id: 'c1', client_name: 'Visible Client' },
      attributes: { hudu_fields: { public: 'visible' } },
      workstation: { cpu_cores: 8 },
      relationships: [{ child_asset_id: 'a2' }],
    });
  });

  it('preserves all fields when the authorization decision has no redactions', () => {
    expect(projectAssetReadFields(response, [])).toEqual(response);
  });
});
