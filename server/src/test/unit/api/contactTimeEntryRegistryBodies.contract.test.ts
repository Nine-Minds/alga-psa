/* @vitest-environment node */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildBaseRegistry, buildDocument } from '../../../lib/api/openapi';
import { chatApiRegistry as ceMcpRegistry } from '../../../lib/mcp/registry.generated';
import { chatApiRegistry as eeMcpRegistry } from '../../../../../ee/server/src/chat/registry/apiRegistry.generated';

const repoRoot = path.resolve(__dirname, '../../../../..');

const bodyOperations = [
  ['post', '/api/v1/contacts'],
  ['put', '/api/v1/contacts/{id}'],
  ['post', '/api/v1/time-entries'],
  ['put', '/api/v1/time-entries/{id}'],
  ['post', '/api/v1/time-entries/bulk'],
  ['put', '/api/v1/time-entries/bulk'],
  ['delete', '/api/v1/time-entries/bulk'],
] as const;

function readSpec(edition: 'ce' | 'ee'): any {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, `sdk/docs/openapi/alga-openapi.${edition}.json`), 'utf8'));
}

function resolveRef(spec: any, schema: any): any {
  if (!schema?.$ref) return schema;
  return schema.$ref.replace(/^#\//, '').split('/').reduce((value: any, key: string) => value?.[key], spec);
}

function requestBody(spec: any, method: string, operationPath: string): any {
  const operation = spec.paths?.[operationPath]?.[method];
  expect(operation, `${method.toUpperCase()} ${operationPath}`).toBeTruthy();
  return resolveRef(spec, operation.requestBody?.content?.['application/json']?.schema);
}

function mcpBody(registry: any[], method: string, operationPath: string): any {
  const entry = registry.find((candidate) => candidate.method === method && candidate.path === operationPath);
  expect(entry, `${method.toUpperCase()} ${operationPath}`).toBeTruthy();
  return entry.requestBodySchema;
}

function expectContactBody(body: any) {
  const phone = body.properties.phone_numbers.items;
  expect(phone.required).toContain('phone_number');
  expect(phone.properties).toEqual(expect.objectContaining({
    phone_number: expect.anything(),
    canonical_type: expect.objectContaining({ enum: ['work', 'mobile', 'home', 'fax', 'other'] }),
    custom_type: expect.anything(),
    extension: expect.anything(),
    is_default: expect.anything(),
    display_order: expect.anything(),
    contact_phone_number_id: expect.anything(),
  }));
  expect(phone.additionalProperties).toBe(false);

  const email = body.properties.additional_email_addresses.items;
  expect(email.required).toContain('email_address');
  expect(email.properties).toEqual(expect.objectContaining({
    email_address: expect.anything(),
    canonical_type: expect.objectContaining({ enum: ['work', 'personal', 'billing', 'other'] }),
    custom_type: expect.anything(),
    display_order: expect.anything(),
    contact_additional_email_address_id: expect.anything(),
  }));
  expect(email.additionalProperties).toBe(false);
}

function expectTimeEntryBody(body: any) {
  expect(Object.keys(body.properties)).toEqual(expect.arrayContaining(['start_time', 'end_time', 'service_id']));
  for (const stale of ['started_at', 'ended_at', 'duration_minutes']) {
    expect(body.properties).not.toHaveProperty(stale);
  }
  expect(body.required).toEqual(expect.arrayContaining(['work_item_type', 'start_time', 'end_time', 'service_id']));
}

describe('contact and time-entry request bodies in generated API artifacts', () => {
  it.each(['ce', 'ee'] as const)('documents the real contact and time-entry bodies in the %s OpenAPI spec', (edition) => {
    const spec = readSpec(edition);
    expectContactBody(requestBody(spec, 'post', '/api/v1/contacts'));
    expectContactBody(requestBody(spec, 'put', '/api/v1/contacts/{id}'));
    expect(requestBody(spec, 'put', '/api/v1/contacts/{id}').properties).not.toHaveProperty('contact_kind');
    expectTimeEntryBody(requestBody(spec, 'post', '/api/v1/time-entries'));
  });

  it.each([
    ['ce', ceMcpRegistry],
    ['ee', eeMcpRegistry],
  ] as const)('documents the real contact and time-entry bodies in the %s MCP registry', (_edition, registry) => {
    expectContactBody(mcpBody(registry as any[], 'post', '/api/v1/contacts'));
    expectTimeEntryBody(mcpBody(registry as any[], 'post', '/api/v1/time-entries'));
  });

  it.each(['ce', 'ee'] as const)('keeps the %s OpenAPI request bodies in sync with the registered zod schemas', (edition) => {
    const generated = readSpec(edition);
    const fresh = JSON.parse(JSON.stringify(buildDocument(buildBaseRegistry({ edition }), {
      title: 'AlgaPSA API',
      version: generated.info.version,
      description: generated.info.description,
      edition,
      servers: generated.servers,
    })));

    for (const [method, operationPath] of bodyOperations) {
      expect(
        requestBody(generated, method, operationPath),
        `${method.toUpperCase()} ${operationPath} is stale; regenerate the OpenAPI and MCP artifacts`,
      ).toEqual(requestBody(fresh, method, operationPath));
    }
  });
});
