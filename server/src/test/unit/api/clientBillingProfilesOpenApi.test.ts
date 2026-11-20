import { describe, expect, it } from 'vitest';
import { createRegistry } from '../../../lib/api/openapi/registry';
import { registerClientBillingProfileRoutes } from '../../../lib/api/openapi/routes/clientsBillingProfiles';
import { buildBaseRegistry } from '../../../lib/api/openapi';

const PATHS = [
  '/api/v1/clients/{id}/billing-profiles',
  '/api/v1/clients/{id}/billing-profiles/{profileId}',
];

describe('client billing profiles OpenAPI', () => {
  it('registers both paths as GET with the client read permission and the generated spec builds', () => {
    const registry = createRegistry();
    registerClientBillingProfileRoutes(registry);
    const routes = registry.getRegisteredRoutes();
    expect(routes.map((r) => `${r.method} ${r.path}`)).toEqual(PATHS.map((p) => `get ${p}`));
    for (const route of routes) {
      expect(route.extensions?.['x-rbac-resource']).toBe('client');
      expect(route.extensions?.['x-rbac-action']).toBe('read');
      expect(route.description).toContain('billing_profile_id');
    }
    const doc = registry.buildDocument({ title: 't', version: 'test', edition: 'ee' }) as any;
    for (const p of PATHS) {
      expect(Object.keys(doc.paths[p])).toEqual(['get']);
      expect(Object.keys(doc.paths[p].get.responses)).toEqual(expect.arrayContaining(['200', '401', '403', '404']));
    }
  });

  it('is wired into the base registry', () => {
    const doc = buildBaseRegistry().buildDocument({ title: 't', version: 'test', edition: 'ee' }) as any;
    for (const p of PATHS) expect(doc.paths[p]?.get).toBeTruthy();
  });
});
