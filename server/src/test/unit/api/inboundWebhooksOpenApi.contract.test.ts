import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

import { generateBaseDocument } from '@/lib/api/openapi';

describe('inbound webhook OpenAPI contracts', () => {
  const generatedCeYaml = () => readFileSync('../sdk/docs/openapi/alga-openapi.ce.yaml', 'utf8');
  const generatedEeYaml = () => readFileSync('../sdk/docs/openapi/alga-openapi.ee.yaml', 'utf8');

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

  it('documents action discovery response as inbound action definitions with target fields', () => {
    const document = generateBaseDocument({
      title: 'Alga PSA API',
      version: '0.1.0-test',
      description: 'Test document',
      edition: 'ce',
    });

    const operation = document.paths?.['/api/v1/inbound-webhooks/actions']?.get as
      | Record<string, any>
      | undefined;
    const actionSchema = document.components?.schemas?.InboundActionDefinition as Record<string, any> | undefined;
    const targetFieldSchema = document.components?.schemas?.InboundActionTargetField as Record<string, any> | undefined;

    expect(operation).toBeTruthy();
    expect(operation?.extensions?.['x-rbac-resource']).toBe('inbound_webhook');
    expect(operation?.extensions?.['x-rbac-action']).toBe('read');
    expect(operation?.responses?.['200']?.content?.['application/json']?.schema).toMatchObject({
      type: 'object',
      properties: {
        data: {
          type: 'array',
          items: { $ref: '#/components/schemas/InboundActionDefinition' },
        },
      },
    });

    expect(actionSchema).toMatchObject({
      type: 'object',
      required: expect.arrayContaining(['name', 'entityType', 'displayName', 'description', 'targetFields']),
      properties: {
        name: { type: 'string' },
        entityType: { type: 'string' },
        targetFields: {
          type: 'array',
          items: { $ref: '#/components/schemas/InboundActionTargetField' },
        },
      },
    });
    expect(targetFieldSchema).toMatchObject({
      type: 'object',
      required: expect.arrayContaining(['name', 'type', 'required', 'description']),
      properties: {
        type: {
          type: 'string',
          enum: expect.arrayContaining(['string', 'int', 'enum', 'ref']),
        },
        enumValues: {
          type: 'array',
          items: { type: 'string' },
        },
      },
    });
  });

  it('includes every inbound webhook API path in the generated CE OpenAPI YAML', () => {
    const yaml = generatedCeYaml();
    const expectedPaths = [
      '/api/v1/inbound-webhooks:',
      '/api/v1/inbound-webhooks/{id}:',
      '/api/v1/inbound-webhooks/{id}/rotate-secret:',
      '/api/v1/inbound-webhooks/{id}/test:',
      '/api/v1/inbound-webhooks/{id}/capture-sample:',
      '/api/v1/inbound-webhooks/{id}/deliveries:',
      '/api/v1/inbound-webhooks/{id}/deliveries/{deliveryId}:',
      '/api/v1/inbound-webhooks/{id}/deliveries/{deliveryId}/replay:',
      '/api/v1/inbound-webhooks/actions:',
    ];

    for (const path of expectedPaths) {
      expect(yaml).toContain(path);
    }
  });

  it('keeps generated EE inbound webhook paths in parity with CE', () => {
    const ceYaml = generatedCeYaml();
    const eeYaml = generatedEeYaml();
    const inboundPathPattern = /^  \/(api\/v1\/inbound-webhooks[^\n:]*|api\/inbound\/\{tenantSlug\}\/\{webhookSlug\}):/gm;

    const cePaths = Array.from(ceYaml.matchAll(inboundPathPattern), (match) => match[0]);
    const eePaths = Array.from(eeYaml.matchAll(inboundPathPattern), (match) => match[0]);

    expect(eePaths).toEqual(cePaths);
  });

  it('documents the templated receiver endpoint with headers and response codes', () => {
    const document = generateBaseDocument({
      title: 'Alga PSA API',
      version: '0.1.0-test',
      description: 'Test document',
      edition: 'ce',
    });

    const operation = document.paths?.['/api/inbound/{tenantSlug}/{webhookSlug}']?.post as
      | Record<string, any>
      | undefined;

    expect(operation).toBeTruthy();
    expect(operation?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'tenantSlug', in: 'path', required: true }),
        expect.objectContaining({ name: 'webhookSlug', in: 'path', required: true }),
        expect.objectContaining({ name: 'x-signature', in: 'header' }),
        expect.objectContaining({ name: 'x-idempotency-key', in: 'header' }),
      ]),
    );
    expect(operation?.requestBody?.content?.['application/json']?.schema).toEqual({});
    expect(operation?.responses).toEqual(
      expect.objectContaining({
        '200': expect.any(Object),
        '401': expect.any(Object),
        '429': expect.any(Object),
        '500': expect.any(Object),
      }),
    );
  });

  it('references InboundWebhookConfig from list, get, and create responses', () => {
    const document = generateBaseDocument({
      title: 'Alga PSA API',
      version: '0.1.0-test',
      description: 'Test document',
      edition: 'ce',
    });

    const listResponse = JSON.stringify(document.paths?.['/api/v1/inbound-webhooks']?.get?.responses);
    const createResponse = JSON.stringify(document.paths?.['/api/v1/inbound-webhooks']?.post?.responses);
    const getResponse = JSON.stringify(document.paths?.['/api/v1/inbound-webhooks/{id}']?.get?.responses);

    expect(listResponse).toContain('#/components/schemas/InboundWebhookConfig');
    expect(createResponse).toContain('#/components/schemas/InboundWebhookConfig');
    expect(getResponse).toContain('#/components/schemas/InboundWebhookConfig');
  });

  it('documents auth config variants for each supported auth_type', () => {
    const document = generateBaseDocument({
      title: 'Alga PSA API',
      version: '0.1.0-test',
      description: 'Test document',
      edition: 'ce',
    });
    const schemaText = JSON.stringify(document.components?.schemas?.InboundWebhookAuthConfig);

    for (const authType of ['hmac_sha256', 'bearer', 'ip_allowlist', 'path_token']) {
      expect(schemaText).toContain(authType);
    }
    expect(schemaText).toContain('signature_header');
    expect(schemaText).toContain('secret_vault_path');
    expect(schemaText).toContain('token_vault_path');
    expect(schemaText).toContain('ip_cidrs');
  });

  it('documents direct-action and workflow handler config variants', () => {
    const document = generateBaseDocument({
      title: 'Alga PSA API',
      version: '0.1.0-test',
      description: 'Test document',
      edition: 'ce',
    });
    const schemaText = JSON.stringify(document.components?.schemas?.InboundWebhookHandlerConfig);

    expect(schemaText).toContain('direct_action');
    expect(schemaText).toContain('field_mapping');
    expect(schemaText).toContain('workflow');
    expect(schemaText).toContain('workflow_id');
  });

  it('documents the WorkflowWebhookEnvelope component with runtime envelope fields', () => {
    const document = generateBaseDocument({
      title: 'Alga PSA API',
      version: '0.1.0-test',
      description: 'Test document',
      edition: 'ce',
    });
    const envelope = document.components?.schemas?.WorkflowWebhookEnvelope as Record<string, any> | undefined;

    expect(envelope).toMatchObject({
      type: 'object',
      required: expect.arrayContaining([
        'source',
        'headers',
        'verified',
        'delivery_id',
        'idempotency_key',
        'received_at',
      ]),
    });
    expect(envelope?.properties).toHaveProperty('body');
    expect(envelope?.properties?.verified).toEqual({ type: 'boolean', enum: [true] });
  });

  it('keeps management route response schemas aligned with registered handlers', () => {
    const document = generateBaseDocument({
      title: 'Alga PSA API',
      version: '0.1.0-test',
      description: 'Test document',
      edition: 'ce',
    });

    expect(document.paths?.['/api/v1/inbound-webhooks']?.post?.requestBody?.content?.['application/json']?.schema).toEqual({
      $ref: '#/components/schemas/InboundWebhookCreateInput',
    });
    expect(document.paths?.['/api/v1/inbound-webhooks/{id}']?.put?.requestBody?.content?.['application/json']?.schema).toEqual({
      $ref: '#/components/schemas/InboundWebhookUpdateInput',
    });
    expect(JSON.stringify(document.paths?.['/api/v1/inbound-webhooks/{id}/test']?.post?.responses)).toContain(
      '#/components/schemas/InboundWebhookDelivery',
    );
  });

  it('documents action discovery output with the InboundActionDefinition array schema', () => {
    const document = generateBaseDocument({
      title: 'Alga PSA API',
      version: '0.1.0-test',
      description: 'Test document',
      edition: 'ce',
    });

    expect(document.paths?.['/api/v1/inbound-webhooks/actions']?.get?.responses?.['200']?.content?.['application/json']?.schema).toMatchObject({
      properties: {
        data: {
          type: 'array',
          items: { $ref: '#/components/schemas/InboundActionDefinition' },
        },
      },
    });
  });
});
