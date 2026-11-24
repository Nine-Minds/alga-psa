import { describe, expect, it } from 'vitest';

import { generateBaseDocument } from '@/lib/api/openapi';

// T007 / F012: the three project materials routes are in the registry with real schemas.
describe('project materials OpenAPI registry', () => {
  const document = generateBaseDocument({
    title: 'AlgaPSA API',
    version: '0.1.0-test',
    description: 'Test document',
    edition: 'ee',
  });
  const paths = document.paths as Record<string, Record<string, any>>;
  const schemas = (document.components?.schemas ?? {}) as Record<string, any>;
  const resolve = (schema: any) => (schema?.$ref ? schemas[schema.$ref.split('/').pop() as string] : schema);

  it('registers GET and POST on /projects/{id}/materials and DELETE on /projects/{id}/materials/{materialId}', () => {
    expect(paths['/api/v1/projects/{id}/materials']?.get).toBeDefined();
    expect(paths['/api/v1/projects/{id}/materials']?.post).toBeDefined();
    expect(paths['/api/v1/projects/{id}/materials/{materialId}']?.delete).toBeDefined();
  });

  it('POST documents the add body field by field, with client_id and allow_reserved_override absent', () => {
    const op = paths['/api/v1/projects/{id}/materials'].post;
    const body = resolve(op.requestBody.content['application/json'].schema);
    expect(body.type).toBe('object');
    expect(Object.keys(body.properties).sort()).toEqual([
      'billing_destination', 'billing_schedule_entry_id', 'currency_code', 'description',
      'quantity', 'rate', 'service_id', 'unit_id',
    ]);
    expect([...body.required].sort()).toEqual(['currency_code', 'quantity', 'rate', 'service_id']);
    expect(body.additionalProperties).toBe(false);
    expect(body.properties.billing_destination.enum).toEqual([
      'next_project_invoice', 'schedule_entry', 'separate', 'project_completion', 'on_hold',
    ]);
    expect(Object.keys(op.responses)).toEqual(expect.arrayContaining(['201', '400', '401', '403', '404']));
  });

  it('GET and DELETE document their responses and path parameters', () => {
    const list = paths['/api/v1/projects/{id}/materials'].get;
    const del = paths['/api/v1/projects/{id}/materials/{materialId}'].delete;
    const listItem = resolve(resolve(list.responses['200'].content['application/json'].schema).properties.data.items);
    expect(Object.keys(listItem.properties)).toEqual(expect.arrayContaining(['project_material_id', 'service_name', 'sku', 'quantity', 'rate', 'currency_code']));
    expect(del.responses['204']).toBeDefined();
    expect(del.responses['204'].content).toBeUndefined();
    expect(Object.keys(del.responses)).toEqual(expect.arrayContaining(['404', '409']));
    expect(del.parameters.map((p: any) => p.name).sort()).toEqual(['id', 'materialId']);
  });
});
