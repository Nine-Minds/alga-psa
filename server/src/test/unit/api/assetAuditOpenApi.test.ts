/**
 * Site audit OpenAPI (mobile 2.0 FR18): every route the controller serves is
 * documented, with the permission each one enforces.
 */
import { describe, expect, it } from 'vitest';
import { createRegistry } from '../../../lib/api/openapi/registry';
import { registerAssetAuditRoutes } from '../../../lib/api/openapi/routes/assetAudits';

function buildRegistry() {
  const registry = createRegistry();
  registerAssetAuditRoutes(registry);
  return registry;
}

function buildDocument() {
  return buildRegistry().buildDocument({ title: 'Asset audits', version: 'test', edition: 'ee' }) as any;
}

const EXPECTED: Array<[string, string, 'read' | 'update']> = [
  ['/api/v1/asset-audits', 'post', 'update'],
  ['/api/v1/asset-audits', 'get', 'read'],
  ['/api/v1/asset-audits/{id}', 'get', 'read'],
  ['/api/v1/asset-audits/{id}/items', 'post', 'update'],
  ['/api/v1/asset-audits/{id}/items/{assetId}', 'delete', 'update'],
  ['/api/v1/asset-audits/{id}/complete', 'post', 'update'],
  ['/api/v1/asset-audits/{id}/cancel', 'post', 'update'],
];

describe('asset audit OpenAPI', () => {
  it('T058 documents all seven audit routes with their asset permission', () => {
    const routes = buildRegistry().getRegisteredRoutes();

    expect(routes.map(({ method, path }) => `${method} ${path}`)).toEqual(
      EXPECTED.map(([path, method]) => `${method} ${path}`),
    );
    for (const [path, method, action] of EXPECTED) {
      const route = routes.find((candidate) => candidate.path === path && candidate.method === method)!;
      expect(route.extensions?.['x-rbac-resource'], `${method} ${path}`).toBe('asset');
      expect(route.extensions?.['x-rbac-action'], `${method} ${path}`).toBe(action);
      expect(route.extensions?.['x-tenant-scoped']).toBe(true);
      expect(route.security).toEqual([{ ApiKeyAuth: [] }]);
    }

    // The document builds and carries every path.
    const document = buildDocument();
    for (const [path, method] of EXPECTED) {
      expect(document.paths?.[path]?.[method], `${method} ${path} missing from the document`).toBeTruthy();
    }
  });

  it('documents 409 on every mutation and the start response as 201', () => {
    const document = buildDocument();

    expect(Object.keys(document.paths['/api/v1/asset-audits'].post.responses)).toContain('201');
    for (const [path, method, action] of EXPECTED) {
      if (action !== 'update' || path === '/api/v1/asset-audits') continue;
      expect(Object.keys(document.paths[path][method].responses), `${method} ${path}`).toContain('409');
    }
  });

  it('documents the list filters mobile and the web share', () => {
    const document = buildDocument();
    const query = document.components.schemas.AssetAuditListQuery;

    expect(Object.keys(query.properties)).toEqual([
      'page',
      'limit',
      'client_id',
      'location_id',
      'no_location',
      'status',
      'started_from',
      'started_to',
    ]);
    expect(query.properties.status.enum).toEqual(['in_progress', 'completed', 'cancelled']);
    // Every filter is optional: the unfiltered list is the mobile call.
    expect(query.required ?? []).toEqual([]);
  });

  it('types the item payload with the columns the web table reads', () => {
    const document = buildDocument();
    const item = document.components.schemas.AssetAuditResponse.properties.data.properties.items.items;

    expect(Object.keys(item.properties)).toEqual(
      expect.arrayContaining(['asset_type', 'marked_by_name', 'asset_tag', 'serial_number']),
    );
    expect(
      Object.keys(document.components.schemas.AssetAuditResponse.properties.data.properties),
    ).toContain('started_by_name');
  });

  it('types the audit payload with its counts and items', () => {
    const document = buildDocument();
    const audit = document.components.schemas.AssetAuditResponse.properties.data;

    expect(Object.keys(audit.properties)).toEqual(
      expect.arrayContaining([
        'audit_id',
        'client_id',
        'location_id',
        'status',
        'expected_count',
        'present_count',
        'missing_count',
        'unexpected_count',
        'items',
      ]),
    );
    expect(audit.properties.status.enum).toEqual(['in_progress', 'completed', 'cancelled']);
    expect(audit.properties.items.items.properties.result.enum).toEqual([
      'expected',
      'present',
      'missing',
      'unexpected',
    ]);
  });
});
