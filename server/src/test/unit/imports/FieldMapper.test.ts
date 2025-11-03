import { describe, it, expect } from 'vitest';
import { FieldMapper } from '@/lib/imports/FieldMapper';
import { createMacAddressValidator, createMacAddressParser, createMaxLengthValidator } from '@/lib/imports/validators';

const definitions = [
  {
    field: 'name',
    label: 'Asset Name',
    required: true,
  },
  {
    field: 'mac_address',
    label: 'MAC Address',
    parser: createMacAddressParser('MAC Address'),
    validators: [createMacAddressValidator('mac_address', 'MAC Address')],
  },
  {
    field: 'notes',
    label: 'Notes',
    validators: [createMaxLengthValidator('notes', 'Notes', 10)],
  },
];

describe('FieldMapper', () => {
  it('maps values and runs validators', async () => {
    const mapper = new FieldMapper(definitions);
    const mapping = [
      { sourceField: 'Name', targetField: 'name' },
      { sourceField: 'MAC', targetField: 'mac_address' },
      { sourceField: 'Notes', targetField: 'notes' },
    ];

    const record = {
      rowNumber: 2,
      raw: { Name: 'Device-1', MAC: '00-11-22-33-44-55', Notes: 'short' },
    };

    const result = await mapper.mapRecord(record, mapping);

    expect(result.errors).toHaveLength(0);
    expect(result.mapped).toEqual({
      name: 'Device-1',
      mac_address: '00:11:22:33:44:55',
      notes: 'short',
    });
  });

  it('returns validation errors for invalid data', async () => {
    const mapper = new FieldMapper(definitions);
    const mapping = [
      { sourceField: 'Name', targetField: 'name' },
      { sourceField: 'MAC', targetField: 'mac_address' },
      { sourceField: 'Notes', targetField: 'notes' },
    ];

    const record = {
      rowNumber: 3,
      raw: { Name: '', MAC: 'invalid-mac', Notes: 'this note is too long' },
    };

    const result = await mapper.mapRecord(record, mapping);

    expect(result.errors).toHaveLength(3);
    expect(result.errors.map((error) => error.field)).toContain('mac_address');
    expect(result.errors.map((error) => error.field)).toContain('name');
    expect(result.errors.map((error) => error.field)).toContain('notes');
  });
});
