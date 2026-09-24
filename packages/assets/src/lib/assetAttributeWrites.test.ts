import { describe, expect, it, vi } from 'vitest';
import type { AssetTypeRegistryEntry } from '@alga-psa/types';
import { getAssetTypeBySlug } from './assetTypeRegistry';
import { attributesMergeExpression, resolveAttributeSchemaForWrite, resolveWritableAssetType, serializeAttributesForInsert, validateAttributesForWrite } from './assetAttributeWrites';

vi.mock('./assetTypeRegistry', () => ({ getAssetTypeBySlug: vi.fn() }));

const entry: AssetTypeRegistryEntry = {
  tenant: 't', type_id: 'id', slug: 'custom', name: 'Custom', icon: null,
  fields_schema: [{ key: 'required_key', label: 'Required', kind: 'text', required: true }],
  is_builtin: false, display_order: 0, created_at: '', updated_at: '',
};

describe('assetAttributeWrites', () => {
  it('resolves built-ins without registry lookup and custom types from the registry', async () => {
    expect(await resolveWritableAssetType({} as any, 't', 'workstation')).toBeNull();
    vi.mocked(getAssetTypeBySlug).mockResolvedValueOnce(entry);
    expect(await resolveWritableAssetType({} as any, 't', 'custom')).toEqual(entry);
  });

  it('rejects unregistered types and handles missing registry fallback as supplied by lookup', async () => {
    vi.mocked(getAssetTypeBySlug).mockResolvedValueOnce(null);
    await expect(resolveWritableAssetType({} as any, 't', 'missing')).rejects.toThrow('invalid_asset_type');
    vi.mocked(getAssetTypeBySlug).mockResolvedValueOnce(null);
    expect(await resolveAttributeSchemaForWrite({} as any, 't', { storedAssetType: 'custom', attributesProvided: true })).toBeNull();
  });

  it('requires required fields for create but permits partial merge while rejecting blanking', () => {
    expect(validateAttributesForWrite(entry, {}, 'create')).toMatchObject([{ key: 'required_key', code: 'required' }]);
    expect(validateAttributesForWrite(entry, {}, 'merge')).toEqual([]);
    expect(validateAttributesForWrite(entry, { required_key: '' }, 'merge')).toMatchObject([{ key: 'required_key', code: 'required' }]);
    expect(validateAttributesForWrite(entry, {}, 'create', { requireCustomAttributes: false })).toEqual([]);
  });

  it('serializes JSON values and builds parameterized jsonb merge expressions', () => {
    expect(serializeAttributesForInsert({ a: 1 })).toBe('{"a":1}');
    const raw = attributesMergeExpression({ raw: (...args: any[]) => args } as any, { a: 1 }) as any;
    expect(raw).toEqual(["coalesce(attributes, '{}'::jsonb) || ?::jsonb", '{"a":1}']);
  });
});
