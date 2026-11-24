import { describe, expect, it } from 'vitest';
import { buildBaseRegistry } from '../../../lib/api/openapi';

const VENDOR_ROUTES = [
  ['get', '/api/v1/inventory/vendors', 'vendor', 'read', false],
  ['post', '/api/v1/inventory/vendors', 'vendor', 'create', true],
  ['get', '/api/v1/inventory/vendors/{vendorId}', 'vendor', 'read', false],
  ['put', '/api/v1/inventory/vendors/{vendorId}', 'vendor', 'update', true],
  ['post', '/api/v1/inventory/vendors/{vendorId}/deactivate', 'vendor', 'update', false],
  ['get', '/api/v1/inventory/vendors/{vendorId}/products', 'vendor', 'read', false],
  ['put', '/api/v1/inventory/vendors/{vendorId}/products/{serviceId}', 'vendor', 'update', true],
  ['delete', '/api/v1/inventory/vendors/{vendorId}/products/{serviceId}', 'vendor', 'update', false],
] as const;

describe('T007: vendor routes in the OpenAPI registry', () => {
  const routes = buildBaseRegistry().getRegisteredRoutes();

  it.each(VENDOR_ROUTES)('%s %s is registered with its RBAC resource/action', (method, path, resource, action) => {
    const route = routes.find((candidate) => candidate.method === method && candidate.path === path);
    expect(route, `${method} ${path}`).toBeTruthy();
    expect(route?.extensions).toMatchObject({ 'x-rbac-resource': resource, 'x-rbac-action': action });
  });

  it('registers exactly the eight vendor routes, and each write body is a real schema rather than the loose body', () => {
    const vendorRoutes = routes.filter((route) => route.path.startsWith('/api/v1/inventory/vendors'));
    expect(vendorRoutes).toHaveLength(8);
    for (const [method, path, , , hasBody] of VENDOR_ROUTES) {
      const route = vendorRoutes.find((candidate) => candidate.method === method && candidate.path === path)!;
      const schema = route.request?.body?.schema as any;
      if (!hasBody) {
        expect(route.request?.body).toBeUndefined();
        continue;
      }
      expect(schema, `${method} ${path} body`).toBeTruthy();
      expect(Object.keys(schema.shape ?? schema._def?.schema?.shape ?? {}).length).toBeGreaterThan(0);
    }
  });
});
