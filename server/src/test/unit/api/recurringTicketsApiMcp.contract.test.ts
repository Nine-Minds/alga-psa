/* @vitest-environment node */

/**
 * Recurring ticket definitions were UI-only until alga-2026-0002909. This guards the published
 * OpenAPI specs and both generated MCP registries, and proves the documented request body is the real
 * package schema rather than a hand-written mirror.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { chatApiRegistry as ceMcpRegistry } from '../../../lib/mcp/registry.generated';
import { chatApiRegistry as eeMcpRegistry } from '../../../../../ee/server/src/chat/registry/apiRegistry.generated';
import { recurringTicketDefinitionInputSchema } from '@alga-psa/tickets/lib/recurring/definitionInput';

const repoRoot = path.resolve(__dirname, '../../../../..');
const BASE = '/api/v1/tickets/recurring';
const D = `${BASE}/{definitionId}`;
const C = `${D}/clients/{clientId}`;

/** [method, path, approvalRequired, rbac action] */
const OPERATIONS = [
  ['get', BASE, false, 'read'],
  ['post', BASE, false, 'create'],
  ['post', `${BASE}/preview`, false, 'read'],
  ['get', D, false, 'read'],
  ['put', D, true, 'update'],
  ['delete', D, true, 'delete'],
  ['post', `${D}/pause`, false, 'update'],
  ['post', `${D}/resume`, true, 'update'],
  ['get', `${D}/upcoming`, false, 'read'],
  ['get', `${D}/occurrences`, false, 'read'],
  ['post', `${D}/clients`, true, 'update'],
  ['put', C, true, 'update'],
  ['post', `${C}/pause`, false, 'update'],
  ['post', `${C}/resume`, true, 'update'],
  ['delete', C, true, 'update'],
] as const;

function resolveRef(spec: any, schema: any): any {
  if (!schema?.$ref) return schema;
  return schema.$ref.replace(/^#\//, '').split('/').reduce((value: any, key: string) => value?.[key], spec);
}

function readSpec(edition: 'ce' | 'ee'): any {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, `sdk/docs/openapi/alga-openapi.${edition}.json`), 'utf8'));
}

describe('recurring ticket definitions in the generated API and MCP artifacts', () => {
  it.each(['ce', 'ee'] as const)('publishes every operation in the %s OpenAPI spec with its RBAC extensions', (edition) => {
    const spec = readSpec(edition);
    for (const [method, operationPath, approval, action] of OPERATIONS) {
      const operation = spec.paths?.[operationPath]?.[method];
      const label = `${method.toUpperCase()} ${operationPath}`;
      expect(operation, label).toBeTruthy();
      expect(operation.description, label).toBeTruthy();
      expect(operation.extensions?.['x-rbac-resource'], label).toBe('recurring_ticket');
      expect(operation.extensions?.['x-rbac-action'], label).toBe(action);
      expect(Boolean(operation.extensions?.['x-chat-approval-required']), label).toBe(approval);
    }
    for (const [method, operationPath] of [['post', BASE], ['put', D]] as const) {
      expect(spec.paths[operationPath][method].extensions['x-rbac-additional-required']).toBe('ticket_template:read');
    }
  });

  it.each(['ce', 'ee'] as const)('documents the real definition schema as the %s POST and PUT body', (edition) => {
    const spec = readSpec(edition);
    const post = resolveRef(spec, spec.paths[BASE].post.requestBody.content['application/json'].schema);
    const put = resolveRef(spec, spec.paths[D].put.requestBody.content['application/json'].schema);

    expect(post.required).toEqual(expect.arrayContaining(['name', 'ticket_template_id', 'recurrence', 'start_date']));
    expect(Object.keys(post.properties).sort()).toEqual(Object.keys(recurringTicketDefinitionInputSchema.shape).sort());
    expect(put).toEqual(post);
    // Descriptions come from the package schema, not from the OpenAPI registration.
    expect(post.properties.lead_days.description).toBeTruthy();
    expect(post.properties.recurrence).toBeTruthy();
  });

  it.each([
    ['ce', ceMcpRegistry],
    ['ee', eeMcpRegistry],
  ] as const)('reaches MCP through the %s registry with the approval map', (_edition, registry) => {
    const entries = registry.filter((entry) => entry.path.startsWith(BASE));

    expect(entries.map((entry) => `${entry.method} ${entry.path}`).sort())
      .toEqual(OPERATIONS.map(([method, operationPath]) => `${method} ${operationPath}`).sort());
    expect(entries.every((entry) => entry.rbacResource === 'recurring_ticket')).toBe(true);

    const approvals = Object.fromEntries(entries.map((entry) => [`${entry.method} ${entry.path}`, entry.approvalRequired]));
    for (const [method, operationPath, approval] of OPERATIONS) {
      expect(approvals[`${method} ${operationPath}`], `${method} ${operationPath}`).toBe(approval);
    }
  });

  it('is discoverable by an agent', () => {
    const find = (method: string, p: string) => ceMcpRegistry.find((entry) => entry.method === method && entry.path === p);

    expect(find('post', BASE)?.description).toContain('/api/v1/tickets/templates');
    expect(find('get', `${D}/upcoming`)?.description.toLowerCase()).toContain('next');
    expect(find('get', `${D}/occurrences`)?.description.toLowerCase()).toContain('history');
    expect(find('put', D)?.description).toContain('Replaces the whole definition');
    expect(find('get', '/api/v1/tickets/templates')?.description).toContain('POST /api/v1/tickets/recurring');
  });
});
