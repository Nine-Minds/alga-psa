/* @vitest-environment node */

import { describe, expect, it } from 'vitest';
import { buildRequest, runRegistrySearch } from '@alga-psa/agent-tooling';
import { chatApiRegistry as ceRegistry } from '../../../../../server/src/lib/mcp/registry.generated';
import { chatApiRegistry as eeRegistry } from '../../chat/registry/apiRegistry.generated';

const actorId = 'f8f6c9bc-b0b1-4c7e-9478-f601911cf119';
const humanWork = [
  ['create ticket', '/api/v1/tickets'],
  ['create time entry', '/api/v1/time-entries'],
] as const;

describe.each(humanWork)('service-principal API discovery: %s', (query, path) => {
  it('discovers the EE act-as input and sends it as a header when invoking human work', () => {
    const search = runRegistrySearch(eeRegistry, { query, limit: 25 });
    expect(search.ok).toBe(true);
    if (!search.ok) throw new Error(search.error);
    const hit = search.data.results.find((entry) => entry.method === 'POST' && entry.path === path);
    expect(hit).toBeDefined();

    const entry = eeRegistry.find((entry) => entry.id === hit?.entryId);
    if (!entry) throw new Error(`Missing registry entry for POST ${path}`);
    const request = buildRequest(entry, { parameters: { 'X-Alga-Act-As': actorId } });
    expect(request.method).toBe('POST');
    expect(request.path).toBe(path);
    expect(request.headers).toEqual({ 'X-Alga-Act-As': actorId });
    expect(request.query).toEqual({});
    expect(buildRequest(entry).headers).toEqual({});
    expect(hit?.parameters).toContainEqual(expect.objectContaining({
      name: 'X-Alga-Act-As',
      in: 'header',
      required: false,
      schema: expect.objectContaining({ type: 'string', format: 'uuid' }),
    }));
  });

  it('keeps EE act-as metadata out of CE discovery', () => {
    const search = runRegistrySearch(ceRegistry, { query, limit: 25 });
    expect(search.ok).toBe(true);
    if (!search.ok) throw new Error(search.error);
    const hit = search.data.results.find((entry) => entry.method === 'POST' && entry.path === path);
    expect(hit).toBeDefined();
    expect(hit?.parameters.some((parameter) => parameter.name === 'X-Alga-Act-As')).toBe(false);

    const entry = ceRegistry.find((entry) => entry.id === hit?.entryId);
    if (!entry) throw new Error(`Missing registry entry for POST ${path}`);
    const request = buildRequest(entry, { parameters: { 'X-Alga-Act-As': actorId } });
    expect(request.headers).toEqual({});
    expect(request.query).toEqual({});
  });
});
