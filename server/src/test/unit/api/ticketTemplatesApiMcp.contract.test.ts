/* @vitest-environment node */

/**
 * Ticket templates were a UI-only feature until alga-2026-0002965: they existed in neither the REST
 * API nor MCP. This guards both surfaces at once — the published OpenAPI specs and the two generated
 * MCP registries — so a future edit cannot quietly drop the endpoints an integration now calls.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { chatApiRegistry as ceMcpRegistry } from '../../../lib/mcp/registry.generated';
import { chatApiRegistry as eeMcpRegistry } from '../../../../../ee/server/src/chat/registry/apiRegistry.generated';

const repoRoot = path.resolve(__dirname, '../../../../..');

const TEMPLATE_OPERATIONS = [
  ['get', '/api/v1/tickets/templates'],
  ['post', '/api/v1/tickets/templates'],
  ['get', '/api/v1/tickets/templates/{templateId}'],
  ['put', '/api/v1/tickets/templates/{templateId}'],
  ['delete', '/api/v1/tickets/templates/{templateId}'],
  ['post', '/api/v1/tickets/templates/{templateId}/instantiate'],
] as const;

function resolveOpenApiSchema(spec: any, schema: any): any {
  if (!schema?.$ref) return schema;
  return schema.$ref
    .replace(/^#\//, '')
    .split('/')
    .reduce((value: any, key: string) => value?.[key], spec);
}

function readSpec(edition: 'ce' | 'ee'): any {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, `sdk/docs/openapi/alga-openapi.${edition}.json`), 'utf8'));
}

describe('ticket templates in the generated API and MCP artifacts', () => {
  it.each(['ce', 'ee'] as const)('publishes every template endpoint in the %s OpenAPI spec', (edition) => {
    const spec = readSpec(edition);

    for (const [method, operationPath] of TEMPLATE_OPERATIONS) {
      const operation = spec.paths?.[operationPath]?.[method];
      expect(operation, `${method.toUpperCase()} ${operationPath}`).toBeTruthy();
      expect(operation.description, `${method.toUpperCase()} ${operationPath}`).toBeTruthy();
    }
  });

  it.each(['ce', 'ee'] as const)('documents the client scope and the instantiate body in the %s spec', (edition) => {
    const spec = readSpec(edition);

    const createBody = resolveOpenApiSchema(
      spec,
      spec.paths['/api/v1/tickets/templates'].post.requestBody?.content?.['application/json']?.schema,
    );
    expect(createBody?.properties?.client_id).toBeTruthy();
    expect(createBody?.properties?.checklist?.type).toBe('array');
    expect(createBody?.required).toEqual(expect.arrayContaining(['name', 'title']));

    const listClientFilter = spec.paths['/api/v1/tickets/templates'].get.parameters
      ?.find((parameter: any) => parameter.name === 'client_id');
    expect(listClientFilter).toBeTruthy();

    const instantiateBody = resolveOpenApiSchema(
      spec,
      spec.paths['/api/v1/tickets/templates/{templateId}/instantiate'].post
        .requestBody?.content?.['application/json']?.schema,
    );
    expect(instantiateBody?.required).toEqual(['client_id']);
    expect(Object.keys(instantiateBody?.properties ?? {})).toEqual(expect.arrayContaining([
      'client_id', 'contact_name_id', 'location_id', 'asset_ids', 'assigned_to', 'status_id', 'due_date',
      'suppressContactNotifications', 'suppressInternalNotifications',
    ]));
  });

  it.each([
    ['ce', ceMcpRegistry],
    ['ee', eeMcpRegistry],
  ] as const)('reaches MCP through the %s registry, with writes behind an approval', (_edition, registry) => {
    const entries = registry.filter((entry) => entry.path.startsWith('/api/v1/tickets/templates'));

    expect(entries.map((entry) => `${entry.method} ${entry.path}`).sort())
      .toEqual(TEMPLATE_OPERATIONS.map(([method, operationPath]) => `${method} ${operationPath}`).sort());
    expect(entries.every((entry) => entry.rbacResource === 'ticket_template')).toBe(true);

    // Replacing or deleting a shared template, and creating a live ticket from one, ask first —
    // the same gate POST /api/v1/tickets sits behind.
    const approvals = Object.fromEntries(entries.map((entry) => [`${entry.method} ${entry.path}`, entry.approvalRequired]));
    expect(approvals).toMatchObject({
      'get /api/v1/tickets/templates': false,
      'post /api/v1/tickets/templates': false,
      'get /api/v1/tickets/templates/{templateId}': false,
      'put /api/v1/tickets/templates/{templateId}': true,
      'delete /api/v1/tickets/templates/{templateId}': true,
      'post /api/v1/tickets/templates/{templateId}/instantiate': true,
    });
  });

  it('tells an agent to instantiate rather than rebuild the checklist item by item', () => {
    const instantiate = ceMcpRegistry.find((entry) =>
      entry.method === 'post' && entry.path === '/api/v1/tickets/templates/{templateId}/instantiate');
    const list = ceMcpRegistry.find((entry) =>
      entry.method === 'get' && entry.path === '/api/v1/tickets/templates');

    expect(instantiate?.description).toContain('created_from_template_id');
    expect(list?.description).toContain('instantiate');
  });
});
