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
      'GET /api/v1/opportunities/work-queue',
      'GET /api/v1/opportunities/{id}',
      'GET /api/v1/opportunities/{id}/timeline',
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
      'GET /api/v1/opportunities/forecast',
      'GET /api/v1/opportunities/calibration',
      'POST /api/v1/opportunities/meeting-sessions',
      'GET /api/v1/opportunities/meeting-sessions/active',
      'POST /api/v1/opportunities/meeting-sessions/{sessionId}/reviews',
      'GET /api/v1/opportunities/{id}/commitments',
      'POST /api/v1/opportunities/{id}/commitments',
      'PUT /api/v1/opportunities/{id}/commitments/{commitmentId}',
      'DELETE /api/v1/opportunities/{id}/commitments/{commitmentId}',
      'GET /api/v1/opportunities/qbr/{clientId}',
      'POST /api/v1/opportunities/qbr/{clientId}/opportunities',
      'GET /api/v1/opportunities/qbr/yield',
      'GET /api/v1/opportunities/rollups',
    ]);
    expect(routes.every((route) => route.extensions?.['x-rbac-resource'] === 'opportunities')).toBe(true);
    expect(routes.find((route) => route.path.endsWith('/unlink'))?.responses[204]?.emptyBody).toBe(true);

    const document = registry.buildDocument({
      title: 'Opportunity API Test',
      version: '1.0.0',
      edition: 'ce',
    });
    expect(document.paths?.['/api/v1/opportunities']?.get).toBeDefined();
    expect(document.paths?.['/api/v1/opportunities/work-queue']?.get).toBeDefined();
    expect(document.paths?.['/api/v1/opportunities/{id}/timeline']?.get).toBeDefined();
    expect(document.paths?.['/api/v1/opportunities/{id}/complete-action']?.post).toBeDefined();
    expect(document.paths?.['/api/v1/opportunities/suggestions/{id}/accept']?.post).toBeDefined();

    const baseDocument = generateBaseDocument({
      title: 'Alga API Test',
      version: '1.0.0',
      edition: 'ce',
    });
    expect(baseDocument.paths?.['/api/v1/opportunities/{id}/quotes/{quoteId}/link']?.post).toBeDefined();

    const newlyRegisteredPaths = [
      '/api/v1/interactions',
      '/api/v1/interactions/{id}',
      '/api/v1/interaction-types',
      '/api/v1/inventory/lookup',
      '/api/v1/inventory/stock',
      '/api/v1/inventory/stock-locations',
      '/api/v1/inventory/units',
      '/api/v1/inventory/units/{unitId}',
      '/api/v1/inventory/receipts',
      '/api/v1/inventory/adjustments',
      '/api/v1/inventory/counts',
      '/api/v1/inventory/counts/{sessionId}',
      '/api/v1/inventory/counts/{sessionId}/records',
      '/api/v1/inventory/counts/{sessionId}/submit',
      '/api/v1/inventory/purchase-orders',
      '/api/v1/inventory/purchase-orders/{poId}',
      '/api/v1/inventory/purchase-orders/{poId}/lines/{lineId}/receive',
      '/api/v1/inventory/transfers',
      '/api/v1/inventory/transfers/{transferId}/receive',
      '/api/v1/mobile/me/capabilities',
    ];
    for (const path of newlyRegisteredPaths) {
      expect(baseDocument.paths?.[path], path).toBeDefined();
    }
    expect(baseDocument.paths?.['/api/v1/interactions']?.get).toBeDefined();
    expect(baseDocument.paths?.['/api/v1/interactions']?.post).toBeDefined();
    expect(baseDocument.paths?.['/api/v1/inventory/counts']?.get).toBeDefined();
    expect(baseDocument.paths?.['/api/v1/inventory/counts']?.post).toBeDefined();
  });

  // Management endpoints are EE-only behavior but CE-visible surface: the CE routes
  // answer 403 instead of 404, so the CE spec has to describe them and say why.
  it('documents the tier-gated management endpoints in the CE document with a denial-aware 403', () => {
    const document = generateBaseDocument({
      title: 'Alga API Test',
      version: '1.0.0',
      edition: 'ce',
    });

    const tierGated: Array<[string, 'get' | 'post' | 'put' | 'delete']> = [
      ['/api/v1/opportunities/forecast', 'get'],
      ['/api/v1/opportunities/calibration', 'get'],
      ['/api/v1/opportunities/meeting-sessions', 'post'],
      ['/api/v1/opportunities/meeting-sessions/active', 'get'],
      ['/api/v1/opportunities/meeting-sessions/{sessionId}/reviews', 'post'],
      ['/api/v1/opportunities/{id}/commitments', 'get'],
      ['/api/v1/opportunities/{id}/commitments', 'post'],
      ['/api/v1/opportunities/{id}/commitments/{commitmentId}', 'put'],
      ['/api/v1/opportunities/{id}/commitments/{commitmentId}', 'delete'],
      ['/api/v1/opportunities/qbr/{clientId}', 'get'],
      ['/api/v1/opportunities/qbr/{clientId}/opportunities', 'post'],
      ['/api/v1/opportunities/qbr/yield', 'get'],
      ['/api/v1/opportunities/rollups', 'get'],
    ];

    for (const [path, method] of tierGated) {
      const operation = (document.paths?.[path] as Record<string, any> | undefined)?.[method];
      expect(operation, `${method.toUpperCase()} ${path}`).toBeDefined();
      // Never the generator's route-inventory placeholder ("GET v1").
      expect(operation.summary, `${method.toUpperCase()} ${path}`).not.toMatch(/^(GET|POST|PUT|DELETE) v1$/);
      expect(operation.description).toContain('ENTERPRISE_EDITION_REQUIRED');
      expect(operation.description).toContain('TIER_ACCESS_DENIED');
      expect(operation.responses?.['403']?.description).toContain('ENTERPRISE_EDITION_REQUIRED');
      expect(operation.tags).toEqual(['Opportunities v1']);
    }
  });
});
