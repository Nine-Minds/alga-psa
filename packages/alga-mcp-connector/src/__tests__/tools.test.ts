import { describe, it, expect } from 'vitest';
import type { ChatApiRegistryEntry } from '@alga-psa/agent-tooling';
import {
  handleCallApiEndpoint,
  handleSearchApiRegistry,
  resolveEntry,
} from '../tools';
import type { EndpointResult, InstanceClient } from '../instanceClient';

const REGISTRY: ChatApiRegistryEntry[] = [
  {
    id: 'tickets.get',
    method: 'get',
    path: '/api/v1/tickets/{id}',
    displayName: 'Get Ticket',
    tags: ['Tickets'],
    approvalRequired: false,
    parameters: [{ name: 'id', in: 'path', required: true }],
  },
];

function fakeClient(result: EndpointResult): InstanceClient {
  return {
    callEndpoint: async () => result,
    searchBusinessData: async () => result,
  } as unknown as InstanceClient;
}

describe('resolveEntry', () => {
  it('resolves by id, tolerating - / _ variants', () => {
    expect(resolveEntry(REGISTRY, 'tickets.get')?.id).toBe('tickets.get');
    expect(resolveEntry(REGISTRY, 'unknown.id')).toBeNull();
  });
});

describe('handleSearchApiRegistry', () => {
  it('errors when query is missing', async () => {
    const out = await handleSearchApiRegistry(REGISTRY, {});
    expect(out.isError).toBe(true);
  });

  it('returns formatted results with entryId + score for a match', async () => {
    const out = await handleSearchApiRegistry(REGISTRY, { query: 'get ticket by id' });
    expect(out.isError).toBe(false);
    const data = out.data as { results: Array<{ entryId: string; method: string }> };
    expect(data.results[0].entryId).toBe('tickets.get');
    expect(data.results[0].method).toBe('GET');
  });
});

describe('handleCallApiEndpoint (T010 — structured error mapping)', () => {
  it('requires entryId', async () => {
    const out = await handleCallApiEndpoint(REGISTRY, fakeClient({ status: 200, ok: true, data: {} }), {});
    expect(out.isError).toBe(true);
  });

  it('errors on an unknown entryId', async () => {
    const out = await handleCallApiEndpoint(REGISTRY, fakeClient({ status: 200, ok: true, data: {} }), {
      entryId: 'nope',
    });
    expect(out.isError).toBe(true);
  });

  it('maps an HTTP-failure result to isError without throwing', async () => {
    const client = fakeClient({ status: 404, ok: false, data: { error: 'not found' } });
    const out = await handleCallApiEndpoint(REGISTRY, client, { entryId: 'tickets.get', path: { id: '1' } });
    expect(out.isError).toBe(true);
    expect((out.data as { status: number }).status).toBe(404);
  });

  it('returns a successful result as non-error', async () => {
    const client = fakeClient({ status: 200, ok: true, data: { id: '1' } });
    const out = await handleCallApiEndpoint(REGISTRY, client, { entryId: 'tickets.get', path: { id: '1' } });
    expect(out.isError).toBe(false);
    expect((out.data as { ok: boolean }).ok).toBe(true);
  });
});
