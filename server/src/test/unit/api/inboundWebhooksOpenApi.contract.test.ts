import { describe, expect, it } from 'vitest';

import { generateBaseDocument } from '@/lib/api/openapi';

describe('inbound webhook OpenAPI contracts', () => {
  it('documents every inbound webhook management route with tenant-scoped RBAC metadata', () => {
    const document = generateBaseDocument({
      title: 'Alga PSA API',
      version: '0.1.0-test',
      description: 'Test document',
      edition: 'ce',
    });

    const managementRoutes = [
      { path: '/api/v1/inbound-webhooks', method: 'get', action: 'read', response: 'InboundWebhookConfig' },
      { path: '/api/v1/inbound-webhooks', method: 'post', action: 'create', request: 'InboundWebhookCreateInput', response: 'InboundWebhookConfig' },
      { path: '/api/v1/inbound-webhooks/{id}', method: 'get', action: 'read', response: 'InboundWebhookConfig', idParam: true },
      { path: '/api/v1/inbound-webhooks/{id}', method: 'put', action: 'update', request: 'InboundWebhookUpdateInput', response: 'InboundWebhookConfig', idParam: true },
      { path: '/api/v1/inbound-webhooks/{id}', method: 'delete', action: 'delete', idParam: true, empty: true },
      { path: '/api/v1/inbound-webhooks/{id}/rotate-secret', method: 'post', action: 'update', response: 'InboundWebhookConfig', idParam: true },
      { path: '/api/v1/inbound-webhooks/{id}/test', method: 'post', action: 'update', response: 'InboundWebhookDelivery', idParam: true },
      { path: '/api/v1/inbound-webhooks/{id}/capture-sample', method: 'post', action: 'update', response: 'InboundWebhookConfig', idParam: true },
      { path: '/api/v1/inbound-webhooks/{id}/capture-sample', method: 'delete', action: 'update', response: 'InboundWebhookConfig', idParam: true },
      { path: '/api/v1/inbound-webhooks/{id}/deliveries', method: 'get', action: 'read', response: 'InboundWebhookDelivery', idParam: true },
      { path: '/api/v1/inbound-webhooks/{id}/deliveries/{deliveryId}', method: 'get', action: 'read', response: 'InboundWebhookDelivery', idParam: true, deliveryParam: true },
      { path: '/api/v1/inbound-webhooks/{id}/deliveries/{deliveryId}/replay', method: 'post', action: 'replay', response: 'InboundWebhookDelivery', idParam: true, deliveryParam: true },
    ] as const;

    for (const route of managementRoutes) {
      const operation = document.paths?.[route.path]?.[route.method] as Record<string, any> | undefined;

      expect(operation, `${route.method.toUpperCase()} ${route.path}`).toBeTruthy();
      expect(operation?.tags).toContain('Inbound Webhooks');
      expect(operation?.security).toEqual([{ ApiKeyAuth: [] }]);
      expect(operation?.extensions?.['x-tenant-scoped']).toBe(true);
      expect(operation?.extensions?.['x-rbac-resource']).toBe('inbound_webhook');
      expect(operation?.extensions?.['x-rbac-action']).toBe(route.action);

      if (route.idParam) {
        expect(operation?.parameters).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              name: 'id',
              in: 'path',
              required: true,
              schema: expect.objectContaining({ type: 'string', format: 'uuid' }),
            }),
          ]),
        );
      }

      if (route.deliveryParam) {
        expect(operation?.parameters).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              name: 'deliveryId',
              in: 'path',
              required: true,
              schema: expect.objectContaining({ type: 'string', format: 'uuid' }),
            }),
          ]),
        );
      }

      if (route.request) {
        expect(operation?.requestBody?.content?.['application/json']?.schema).toEqual({
          $ref: `#/components/schemas/${route.request}`,
        });
      }

      if (route.empty) {
        expect(operation?.responses?.['204']?.content).toBeUndefined();
      } else if (route.response) {
        expect(JSON.stringify(operation?.responses)).toContain(`#/components/schemas/${route.response}`);
      }
    }
  });
});
