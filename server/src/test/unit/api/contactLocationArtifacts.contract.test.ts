/* @vitest-environment node */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { chatApiRegistry as ceMcpRegistry } from '../../../lib/mcp/registry.generated';
import { chatApiRegistry as eeMcpRegistry } from '../../../../../ee/server/src/chat/registry/apiRegistry.generated';

/**
 * T092: regenerating the artifacts is what exposes contact locations to an agent, so the committed
 * spec and registry are asserted to carry the fields, the two filters and contact_count — not just
 * to mention them in prose.
 */

const repoRoot = path.resolve(__dirname, '../../../../..');

function readSpec(edition: 'ce' | 'ee'): any {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, `sdk/docs/openapi/alga-openapi.${edition}.json`), 'utf8'));
}

function resolveRef(spec: any, schema: any): any {
  if (!schema?.$ref) return schema;
  return schema.$ref.replace(/^#\//, '').split('/').reduce((value: any, key: string) => value?.[key], spec);
}

function queryNames(spec: any, operationPath: string): string[] {
  const parameters = spec.paths?.[operationPath]?.get?.parameters ?? [];
  return parameters
    .map((parameter: any) => resolveRef(spec, parameter))
    .filter((parameter: any) => parameter.in === 'query')
    .map((parameter: any) => parameter.name);
}

function registryParams(registry: any[], method: string, operationPath: string): string[] {
  const entry = registry.find((candidate) => candidate.method === method && candidate.path === operationPath);
  expect(entry, `${method.toUpperCase()} ${operationPath}`).toBeTruthy();
  return (entry.parameters ?? [])
    .filter((parameter: any) => parameter.in === 'query')
    .map((parameter: any) => parameter.name);
}

describe('contact locations in the generated API artifacts', () => {
  it.each(['ce', 'ee'] as const)('documents the two contact filters on both list routes in %s', (edition) => {
    const spec = readSpec(edition);
    for (const operationPath of ['/api/v1/contacts', '/api/v1/clients/{id}/contacts']) {
      expect(queryNames(spec, operationPath)).toEqual(
        expect.arrayContaining(['location_id', 'work_arrangement']),
      );
    }
  });

  it.each([
    ['ce', ceMcpRegistry],
    ['ee', eeMcpRegistry],
  ] as const)('exposes the two contact filters to the %s MCP registry', (_edition, registry) => {
    for (const operationPath of ['/api/v1/contacts', '/api/v1/clients/{id}/contacts']) {
      expect(registryParams(registry as any[], 'get', operationPath)).toEqual(
        expect.arrayContaining(['location_id', 'work_arrangement']),
      );
    }
  });

  it.each(['ce', 'ee'] as const)('carries locations[], work_arrangement and contact_count in %s', (edition) => {
    const spec = readSpec(edition);
    const contact = spec.components?.schemas?.ContactResource;
    expect(contact?.properties).toEqual(expect.objectContaining({
      work_arrangement: expect.anything(),
      locations: expect.anything(),
    }));
    const link = resolveRef(spec, contact.properties.locations.items);
    expect(Object.keys(link.properties)).toEqual(
      expect.arrayContaining(['location_id', 'location_name', 'is_primary', 'city']),
    );
    // The export rows carry the links too, so a reporting caller never has to join them back.
    expect(spec.components?.schemas?.ContactExportRow?.properties).toEqual(expect.objectContaining({
      work_arrangement: expect.anything(),
      locations: expect.anything(),
    }));
    // contact_count rides on every client location row: it is also why a delete would be refused.
    const locationRow = spec.components?.schemas?.ClientLocationsEnvelope?.properties?.data?.items;
    expect(resolveRef(spec, locationRow)?.properties).toEqual(
      expect.objectContaining({ contact_count: expect.anything() }),
    );
  });
});
