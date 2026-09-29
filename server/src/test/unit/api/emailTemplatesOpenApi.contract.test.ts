import { describe, expect, it } from 'vitest';
import { chatApiRegistry } from '../../../lib/mcp/registry.generated';
import { createRegistry } from '../../../lib/api/openapi/registry';
import { registerBaseComponents } from '../../../lib/api/openapi/components';
import { registerEmailTemplateRoutes } from '../../../lib/api/openapi/routes/emailTemplates';
import { generateBaseDocument } from '../../../lib/api/openapi';
import { getApiMetadataProducts, resolveProductApiBehavior } from '../../../lib/productSurfaceRegistry';

const ENDPOINTS = [
  'GET /api/v1/email/templates',
  'GET /api/v1/email/templates/{name}',
  'PUT /api/v1/email/templates/{name}',
  'DELETE /api/v1/email/templates/{name}',
];

describe('email templates OpenAPI registration', () => {
  it('registers every implemented endpoint with settings RBAC metadata', () => {
    const registry = createRegistry();
    const components = registerBaseComponents(registry);
    registerEmailTemplateRoutes(registry, components);
    const routes = registry.getRegisteredRoutes();

    expect(routes.map(({ method, path }) => `${method.toUpperCase()} ${path}`)).toEqual(ENDPOINTS);
    expect(routes.every((route) => route.extensions?.['x-rbac-resource'] === 'settings')).toBe(true);
    expect(routes.every((route) => route.extensions?.['x-chat-callable'] === true)).toBe(true);
    expect(routes.find((route) => route.method === 'delete')?.responses[204]?.emptyBody).toBe(true);
  });

  it('asks for approval before writing and not before reading', () => {
    const registry = createRegistry();
    const components = registerBaseComponents(registry);
    registerEmailTemplateRoutes(registry, components);

    const approval = Object.fromEntries(
      registry.getRegisteredRoutes().map((route) => [route.method, route.extensions?.['x-chat-approval-required']]),
    );

    expect(approval).toEqual({ get: false, put: true, delete: true });
  });

  it('ships in both editions', () => {
    for (const edition of ['ce', 'ee'] as const) {
      const document = generateBaseDocument({ title: 'Alga API Test', version: '1.0.0', edition });

      expect(document.paths?.['/api/v1/email/templates']?.get).toBeDefined();
      expect(document.paths?.['/api/v1/email/templates/{name}']?.get).toBeDefined();
      expect(document.paths?.['/api/v1/email/templates/{name}']?.put).toBeDefined();
      expect(document.paths?.['/api/v1/email/templates/{name}']?.delete).toBeDefined();
    }
  });

  it('reaches MCP through the generated registry, writes behind an approval', () => {
    const entries = chatApiRegistry.filter((entry) => entry.path.startsWith('/api/v1/email/templates'));

    expect(entries.map((entry) => `${entry.method.toUpperCase()} ${entry.path}`).sort())
      .toEqual([...ENDPOINTS].sort());
    expect(entries.every((entry) => entry.rbacResource === 'settings')).toBe(true);
    expect(Object.fromEntries(entries.map((entry) => [entry.method, entry.approvalRequired])))
      .toEqual({ get: false, put: true, delete: true });
  });

  it('follows the PSA-only notification settings surface', () => {
    expect(resolveProductApiBehavior('psa', '/api/v1/email/templates')).toBe('allowed');
    expect(resolveProductApiBehavior('psa', '/api/v1/email/templates/ticket-created')).toBe('allowed');
    expect(resolveProductApiBehavior('algadesk', '/api/v1/email/templates/ticket-created')).toBe('denied');
    expect(getApiMetadataProducts('/api/v1/email/templates')).toEqual(['psa']);
    // The rest of the email surface is untouched.
    expect(resolveProductApiBehavior('algadesk', '/api/v1/email/providers')).toBe('allowed');
  });
});
