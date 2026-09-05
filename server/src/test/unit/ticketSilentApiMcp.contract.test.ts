/* @vitest-environment node */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { chatApiRegistry as ceMcpRegistry } from '../../lib/mcp/registry.generated';
import { chatApiRegistry as eeMcpRegistry } from '../../../../ee/server/src/chat/registry/apiRegistry.generated';

const repoRoot = path.resolve(__dirname, '../../../..');

const silentTicketOperations = [
  ['put', '/api/v1/tickets/{id}'],
  ['put', '/api/v1/tickets/{id}/status'],
  ['put', '/api/v1/tickets/{id}/assignment'],
  ['post', '/api/v1/tickets/{id}/comments'],
  ['post', '/api/v1/tickets/{id}/agents'],
  ['put', '/api/v1/tickets/{id}/team'],
] as const;

function resolveOpenApiSchema(spec: any, schema: any): any {
  if (!schema?.$ref) return schema;
  return schema.$ref
    .replace(/^#\//, '')
    .split('/')
    .reduce((value: any, key: string) => value?.[key], spec);
}

describe('silent ticket updates in generated API and MCP artifacts', () => {
  it.each(['ce', 'ee'] as const)('publishes both suppression flags in the %s OpenAPI website spec', (edition) => {
    const spec = JSON.parse(fs.readFileSync(
      path.join(repoRoot, `sdk/docs/openapi/alga-openapi.${edition}.json`),
      'utf8',
    ));

    for (const [method, operationPath] of silentTicketOperations) {
      const operation = spec.paths?.[operationPath]?.[method];
      expect(operation, `${method.toUpperCase()} ${operationPath}`).toBeTruthy();
      const schema = resolveOpenApiSchema(
        spec,
        operation.requestBody?.content?.['application/json']?.schema,
      );
      expect(schema?.properties?.suppressContactNotifications?.type).toBe('boolean');
      expect(schema?.properties?.suppressInternalNotifications?.type).toBe('boolean');
      expect(schema?.properties?.suppressInternalNotifications?.description).toContain(
        'Requires suppressContactNotifications=true',
      );
    }
  });

  it.each([
    ['ce', ceMcpRegistry],
    ['ee', eeMcpRegistry],
  ] as const)('publishes both suppression inputs in the %s MCP registry', (_edition, registry) => {
    for (const [method, operationPath] of silentTicketOperations) {
      const entry = registry.find((candidate) =>
        candidate.method === method && candidate.path === operationPath
      );
      expect(entry, `${method.toUpperCase()} ${operationPath}`).toBeTruthy();
      expect(entry?.requestBodySchema?.properties).toEqual(expect.objectContaining({
        suppressContactNotifications: expect.objectContaining({ type: 'boolean' }),
        suppressInternalNotifications: expect.objectContaining({ type: 'boolean' }),
      }));
    }
  });
});
