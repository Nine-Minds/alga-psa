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

  it('masks field-labelled historical deltas when a redaction covers an ancestor path', () => {
    expect(projectAssetReadFields({
      changes: [{ field: 'workstation.serial_number', before: 'SECRET', after: 'SECRET2' }],
    }, ['workstation'])).toEqual({ changes: [{ field: 'workstation.serial_number' }] });
  });

  it('matches dotted extension and attribute paths below history wrappers and retains sibling values', () => {
    expect(projectAssetReadFields({
      changes: {
        fields: {
          workstation: { serial_number: { before: 'SECRET', after: 'SECRET2' }, os_version: 'keep-os' },
          attributes: { hudu_fields: { password: 'SECRET-PASSWORD', public_note: 'keep-note' } },
        },
        maintenance_data: {
          workstation: { serial_number: 'SECRET-MAINTENANCE', os_version: 'keep-maintenance-os' },
          attributes: { hudu_fields: { password: 'SECRET-MAINTENANCE-PASSWORD', public_note: 'keep-maintenance-note' } },
        },
      },
    }, ['workstation.serial_number', 'attributes.hudu_fields.password'])).toEqual({
      changes: {
        fields: {
          workstation: { os_version: 'keep-os' },
          attributes: { hudu_fields: { public_note: 'keep-note' } },
        },
        maintenance_data: {
          workstation: { os_version: 'keep-maintenance-os' },
          attributes: { hudu_fields: { public_note: 'keep-maintenance-note' } },
        },
      },
    });
  });

  it('preserves Date and other non-plain values when projecting a list row', () => {
    const observedAt = new Date('2026-10-21T12:34:56.000Z');
    const marker = new Map([['key', 'value']]);
    const result = projectAssetReadFields({ created_at: observedAt, marker, name: 'visible' }, []);
    expect(result.created_at).toBe(observedAt);
    expect(result.created_at).toBeInstanceOf(Date);
    expect(result.marker).toBe(marker);
  });

  it('masks both sides of duplicated response aliases without matching same-named nested fields broadly', () => {
    const asset = {
      contact_name_id: 'contact-1', contact_name: 'Contact Secret',
      client_name: 'Client Secret', client: { client_name: 'Client Secret' },
      workstation: { serial_number: 'Extension Secret' },
      unrelated: { serial_number: 'Must remain' },
    };
    expect(projectAssetReadFields(asset, ['contact_name_id', 'client.client_name'])).toEqual({
      client: {},
      workstation: { serial_number: 'Extension Secret' },
      unrelated: { serial_number: 'Must remain' },
    });
    expect(projectAssetReadFields(asset, ['contact_name', 'client_name'])).toEqual({
      client: {},
      workstation: { serial_number: 'Extension Secret' },
      unrelated: { serial_number: 'Must remain' },
    });
  });

  it('masks duplicated client identifiers from either path and expands a client ancestor to its flat alias', () => {
    const asset = {
      client_id: 'client-secret', client_name: 'Client Secret',
      client: { client_id: 'client-secret', client_name: 'Client Secret', unrelated: 'keep' },
      unrelated: { client_id: 'not-an-alias', client_name: 'keep' },
    };
    expect(projectAssetReadFields(asset, ['client_id'])).toEqual({
      client_name: 'Client Secret', client: { client_name: 'Client Secret', unrelated: 'keep' },
      unrelated: { client_id: 'not-an-alias', client_name: 'keep' },
    });
    expect(projectAssetReadFields(asset, ['client.client_id'])).toEqual({
      client_name: 'Client Secret', client: { client_name: 'Client Secret', unrelated: 'keep' },
      unrelated: { client_id: 'not-an-alias', client_name: 'keep' },
    });
    expect(projectAssetReadFields(asset, ['client'])).toEqual({
      unrelated: { client_id: 'not-an-alias', client_name: 'keep' },
    });
  });
});
