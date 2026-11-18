import { describe, expect, it } from 'vitest';
import { createRegistry } from '../../../lib/api/openapi/registry';
import { registerPortalInvitationRoutes } from '../../../lib/api/openapi/routes/portalInvitations';
import { buildBaseRegistry } from '../../../lib/api/openapi';
import { resolveProductApiBehavior } from '../../../lib/productSurfaceRegistry';

const PATHS = [
  '/api/v1/clients/{id}/portal-invitations',
  '/api/v1/portal-invitations/bulk',
];

describe('portal invitations OpenAPI', () => {
  it('registers both paths as POST under user:invite and the generated spec builds', () => {
    const registry = createRegistry();
    registerPortalInvitationRoutes(registry);
    const routes = registry.getRegisteredRoutes();
    expect(routes.map((r) => `${r.method} ${r.path}`)).toEqual(PATHS.map((p) => `post ${p}`));
    for (const route of routes) {
      expect(route.extensions?.['x-rbac-resource']).toBe('user');
      expect(route.extensions?.['x-rbac-action']).toBe('invite');
    }
    const doc = registry.buildDocument({ title: 't', version: 'test', edition: 'ee' }) as any;
    for (const p of PATHS) {
      expect(Object.keys(doc.paths[p])).toEqual(['post']);
      expect(Object.keys(doc.paths[p].post.responses)).toEqual(expect.arrayContaining(['200', '400', '401', '403']));
    }
  });

  it('is wired into the base registry', () => {
    const doc = buildBaseRegistry().buildDocument({ title: 't', version: 'test', edition: 'ee' }) as any;
    for (const p of PATHS) expect(doc.paths[p]?.post).toBeTruthy();
  });

  it('is ruled in the product surface registry rather than riding the fallback', () => {
    for (const product of ['psa', 'algadesk'] as const) {
      expect(resolveProductApiBehavior(product, '/api/v1/portal-invitations/bulk')).toBe('allowed');
    }
  });
});
