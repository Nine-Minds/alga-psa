import { describe, expect, it } from 'vitest';
import { createRegistry } from '../../../lib/api/openapi/registry';
import { registerOpportunitiesV1Routes } from '../../../lib/api/openapi/routes/opportunitiesV1';
import { generateBaseDocument } from '../../../lib/api/openapi';

describe('opportunities v1 OpenAPI registration', () => {
  it('registers every implemented endpoint with opportunities RBAC metadata', () => {
    const registry = createRegistry();
    registerOpportunitiesV1Routes(registry);
    const routes = registry.getRegisteredRoutes();

    expect(routes.map(({ method, path }) => `${method.toUpperCase()} ${path}`)).toEqual([
      'GET /api/v1/opportunities',
      'POST /api/v1/opportunities',
      'GET /api/v1/opportunities/{id}',
      'PUT /api/v1/opportunities/{id}',
      'DELETE /api/v1/opportunities/{id}',
      'POST /api/v1/opportunities/{id}/win',
      'POST /api/v1/opportunities/{id}/lose',
      'POST /api/v1/opportunities/{id}/complete-action',
      'POST /api/v1/opportunities/{id}/evidence',
      'GET /api/v1/opportunities/{id}/evidence',
      'POST /api/v1/opportunities/{id}/evidence/{evidenceId}/correct',
      'POST /api/v1/opportunities/{id}/quotes/{quoteId}/link',
      'POST /api/v1/opportunities/{id}/quotes/{quoteId}/unlink',
      'GET /api/v1/opportunities/suggestions',
      'POST /api/v1/opportunities/suggestions/{id}/accept',
      'POST /api/v1/opportunities/suggestions/{id}/dismiss',
      'POST /api/v1/opportunities/suggestions/{id}/snooze',
    ]);
    expect(routes.every((route) => route.extensions?.['x-rbac-resource'] === 'opportunities')).toBe(true);
    expect(routes.find((route) => route.path.endsWith('/unlink'))?.responses[204]?.emptyBody).toBe(true);

    const document = registry.buildDocument({
      title: 'Opportunity API Test',
      version: '1.0.0',
      edition: 'ce',
    });
    expect(document.paths?.['/api/v1/opportunities']?.get).toBeDefined();
    expect(document.paths?.['/api/v1/opportunities/{id}/complete-action']?.post).toBeDefined();
    expect(document.paths?.['/api/v1/opportunities/suggestions/{id}/accept']?.post).toBeDefined();

    const baseDocument = generateBaseDocument({
      title: 'Alga API Test',
      version: '1.0.0',
      edition: 'ce',
    });
    expect(baseDocument.paths?.['/api/v1/opportunities/{id}/quotes/{quoteId}/link']?.post).toBeDefined();
  });
});
