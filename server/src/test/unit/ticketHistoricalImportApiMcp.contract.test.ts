/* @vitest-environment node */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { chatApiRegistry as ceMcpRegistry } from '../../lib/mcp/registry.generated';
import { chatApiRegistry as eeMcpRegistry } from '../../../../ee/server/src/chat/registry/apiRegistry.generated';

const repoRoot = path.resolve(__dirname, '../../../..');

function resolveOpenApiSchema(spec: any, schema: any): any {
  if (!schema?.$ref) return schema;
  return schema.$ref
    .replace(/^#\//, '')
    .split('/')
    .reduce((value: any, key: string) => value?.[key], spec);
}

const createFields = ['entered_at', 'closed_at', 'closed_by'] as const;

describe('historical ticket import in generated API and MCP artifacts', () => {
  it.each(['ce', 'ee'] as const)('publishes entered_at/closed_at/closed_by and comment created_at in the %s OpenAPI spec', (edition) => {
    const spec = JSON.parse(fs.readFileSync(
      path.join(repoRoot, `sdk/docs/openapi/alga-openapi.${edition}.json`),
      'utf8',
    ));

    const create = spec.paths?.['/api/v1/tickets']?.post;
    const createSchema = resolveOpenApiSchema(spec, create?.requestBody?.content?.['application/json']?.schema);
    for (const field of createFields) {
      expect(createSchema?.properties?.[field], `POST /api/v1/tickets ${field}`).toBeTruthy();
    }

    const comment = spec.paths?.['/api/v1/tickets/{id}/comments']?.post;
    const commentSchema = resolveOpenApiSchema(spec, comment?.requestBody?.content?.['application/json']?.schema);
    expect(commentSchema?.properties?.created_at, 'POST comments created_at').toBeTruthy();
  });

  it.each([
    ['ce', ceMcpRegistry],
    ['ee', eeMcpRegistry],
  ] as const)('publishes the historical fields in the %s MCP registry', (_edition, registry) => {
    const create = registry.find((e) => e.method === 'post' && e.path === '/api/v1/tickets');
    expect(create).toBeTruthy();
    for (const field of createFields) {
      expect(create?.requestBodySchema?.properties?.[field], field).toBeTruthy();
    }
    expect(create?.description).toMatch(/HISTORICAL IMPORT/);

    const comment = registry.find((e) => e.method === 'post' && e.path === '/api/v1/tickets/{id}/comments');
    expect(comment?.requestBodySchema?.properties?.created_at).toBeTruthy();
  });
});
