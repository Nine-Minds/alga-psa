import { beforeAll, describe, expect, it } from 'vitest';

import { zodToWorkflowJsonSchema } from '../../jsonSchemaMetadata';
import { getActionRegistryV2 } from '../../registries/actionRegistry';
import { registerDataStoreActions } from '../businessOperations/dataStore';
import { registerEntityLinkActions } from '../businessOperations/entityLinks';

const READ_ACTIONS = [
  'store.get',
  'store.list',
  'store.list_namespaces',
  'links.lookup',
  'links.list',
  'links.list_namespaces',
] as const;

const WRITE_ACTIONS = [
  'store.set',
  'store.delete',
  'store.increment',
  'links.upsert',
  'links.delete',
] as const;

describe('workflow data-store action registration metadata', () => {
  beforeAll(() => {
    const registry = getActionRegistryV2();
    if (!registry.get('store.get', 1)) {
      registerDataStoreActions();
    }
    if (!registry.get('links.lookup', 1)) {
      registerEntityLinkActions();
    }
  });

  it('serializes reused entity-ref fields (left/right) as inline objects, not unresolved $refs', () => {
    const registry = getActionRegistryV2();
    const upsert = registry.get('links.upsert', 1);
    expect(upsert).toBeDefined();
    const schema = zodToWorkflowJsonSchema(upsert!.inputSchema, { name: 'links.upsert@1.input' }) as any;
    const root = schema.definitions?.['links.upsert@1.input'] ?? schema;
    // Internal subschema refs would break the designer's field editor (renders as "string").
    expect(JSON.stringify(root)).not.toContain('$ref');
    for (const side of ['from', 'to'] as const) {
      expect(root.properties?.[side]?.type, `${side} should be an object`).toBe('object');
      expect(Object.keys(root.properties?.[side]?.properties ?? {}).sort()).toEqual(['id', 'type']);
    }
  });

  it('T001: registers store and links actions with labels and side-effect/idempotency metadata', () => {
    const registry = getActionRegistryV2();
    const expectedLabels: Record<string, string> = {
      'store.get': 'Get Stored Value',
      'store.set': 'Set Stored Value',
      'store.delete': 'Delete Stored Value',
      'store.increment': 'Increment Stored Number',
      'store.list': 'List Stored Values',
      'store.list_namespaces': 'List Store Namespaces',
      'links.upsert': 'Upsert Entity Link',
      'links.lookup': 'Lookup Entity Links',
      'links.delete': 'Delete Entity Links',
      'links.list': 'List Entity Links',
      'links.list_namespaces': 'List Link Namespaces',
    };

    for (const actionId of [...READ_ACTIONS, ...WRITE_ACTIONS]) {
      const action = registry.get(actionId, 1);
      expect(action, `${actionId}@1 should be registered`).toBeDefined();
      expect(action?.ui?.label).toBe(expectedLabels[actionId]);
      expect(action?.ui?.category).toBe('Data Store');
    }

    for (const actionId of READ_ACTIONS) {
      const action = registry.get(actionId, 1);
      expect(action?.sideEffectful).toBe(false);
      expect(action?.idempotency.mode).toBe('engineProvided');
    }

    for (const actionId of WRITE_ACTIONS) {
      const action = registry.get(actionId, 1);
      expect(action?.sideEffectful).toBe(true);
      expect(action?.idempotency.mode).toBe('actionProvided');
    }
  });

  it('T002: store schemas expose Data Store designer field metadata', () => {
    const registry = getActionRegistryV2();
    const storeSet = registry.get('store.set', 1);
    const storeList = registry.get('store.list', 1);
    expect(storeSet).toBeDefined();
    expect(storeList).toBeDefined();

    const setSchema = zodToWorkflowJsonSchema(storeSet!.inputSchema) as any;
    const listSchema = zodToWorkflowJsonSchema(storeList!.inputSchema) as any;
    const setProps = setSchema.properties;
    const listProps = listSchema.properties;

    expect(setProps.namespace['x-workflow-editor'].softEnum).toMatchObject({
      component: 'soft-enum-combobox',
      suggestionKind: 'workflow-data-store-namespace',
      allowCustomValue: true,
    });
    expect(setProps.key['x-workflow-editor']).toMatchObject({
      kind: 'text',
      allowsDynamicReference: true,
    });
    expect(setProps.value['x-workflow-editor']).toMatchObject({
      kind: 'json',
      allowsDynamicReference: true,
    });
    expect(setProps.value_type.enum).toEqual(['string', 'number', 'boolean', 'json']);
    expect(listProps.limit.maximum).toBe(200);
  });

  it('T002: link schemas expose soft-enum entity metadata and direction select options', () => {
    const registry = getActionRegistryV2();
    const upsert = registry.get('links.upsert', 1);
    const lookup = registry.get('links.lookup', 1);
    expect(upsert).toBeDefined();
    expect(lookup).toBeDefined();

    const upsertSchema = zodToWorkflowJsonSchema(upsert!.inputSchema) as any;
    const lookupSchema = zodToWorkflowJsonSchema(lookup!.inputSchema) as any;
    const upsertProps = upsertSchema.properties;
    const lookupProps = lookupSchema.properties;

    expect(upsertProps.namespace['x-workflow-editor'].softEnum.suggestionKind).toBe('workflow-data-store-namespace');
    expect(upsertProps.from.properties.type['x-workflow-editor'].softEnum).toMatchObject({
      component: 'soft-enum-combobox',
      suggestionKind: 'workflow-entity-type',
      namespaceField: 'namespace',
      allowCustomValue: true,
    });
    expect(upsertProps.relation['x-workflow-editor'].softEnum).toMatchObject({
      component: 'soft-enum-combobox',
      suggestionKind: 'workflow-link-relation',
      namespaceField: 'namespace',
      allowCustomValue: true,
    });
    expect(upsertProps.from.properties.id['x-workflow-editor']).toMatchObject({
      kind: 'text',
      allowsDynamicReference: true,
    });
    expect(lookupProps.direction.enum).toEqual(['forward', 'reverse', 'either']);
    expect(lookupProps.limit.maximum).toBe(200);
  });

  it('T010: action input schemas reject over-length labels and ids at validation time', async () => {
    const registry = getActionRegistryV2();
    const storeSet = registry.get('store.set', 1)!;
    const linkLookup = registry.get('links.lookup', 1)!;
    const tooLong = 'x'.repeat(257);

    expect(() => storeSet.inputSchema.parse({
      namespace: tooLong,
      key: 'k',
      value: true,
    })).toThrow();

    expect(() => linkLookup.inputSchema.parse({
      namespace: 'mirror',
      from: { type: 'project_task', id: tooLong },
    })).toThrow();
  });
});
