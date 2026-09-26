import { describe, expect, it } from 'vitest';
import { seedCustomAssetFieldMappings } from '../../../components/settings/migrations/MigrationConfigurePanel';

const assetTypes = [
  { slug: 'workstation', name: 'Workstation', isBuiltin: true, fields: [] },
  { slug: 'door_access', name: 'Door Access', isBuiltin: false, fields: [{ key: 'door_count', label: 'Door Count', kind: 'number', required: false }] },
] as never;
const sourceFields = [
  { assetTypeName: 'Workstation', fieldName: 'Door Count', sampleValue: '3', recordCount: 1 },
  { assetTypeName: 'Door Access', fieldName: 'Door Count', sampleValue: '3', recordCount: 1 },
] as never;

describe('custom asset field configuration defaults', () => {
  it('keeps built-in imports free of custom mappings when reopening and preparing to save', () => {
    expect(seedCustomAssetFieldMappings(
      { Workstation: 'workstation' },
      { workstation: {} },
      assetTypes,
      sourceFields
    )).toEqual({});
  });

  it('matches fields after a fresh custom type selection and preserves saved mappings and explicit clears', () => {
    expect(seedCustomAssetFieldMappings({ 'Door Access': 'door_access' }, {}, assetTypes, sourceFields))
      .toEqual({ door_access: { 'Door Count': 'door_count' } });
    expect(seedCustomAssetFieldMappings(
      { 'Door Access': 'door_access' },
      { door_access: {} },
      assetTypes,
      sourceFields
    )).toEqual({ door_access: {} });
    expect(seedCustomAssetFieldMappings(
      { 'Door Access': 'door_access' },
      { door_access: { 'Door Count': 'custom_key' } },
      assetTypes,
      sourceFields
    )).toEqual({ door_access: { 'Door Count': 'custom_key' } });
  });
});
