import { describe, it, expect } from 'vitest';
import { buildRequest } from '../buildRequest';
import type { ChatApiRegistryEntry } from '../../registry/schema';

function entry(
  e: Partial<ChatApiRegistryEntry> &
    Pick<ChatApiRegistryEntry, 'id' | 'method' | 'path'>,
): ChatApiRegistryEntry {
  return { displayName: e.id, tags: [], approvalRequired: false, parameters: [], ...e };
}

describe('buildRequest (T003 — method + path-param substitution)', () => {
  it('substitutes path params and defaults to the entry method', () => {
    const e = entry({
      id: 'tickets.get',
      method: 'get',
      path: '/api/v1/tickets/{id}',
      parameters: [{ name: 'id', in: 'path', required: true }],
    });
    const req = buildRequest(e, { path: { id: 'abc-123' } });
    expect(req.method).toBe('GET');
    expect(req.path).toBe('/api/v1/tickets/abc-123');
    expect(req.isMutation).toBe(false);
  });

  it('encodes path param values and resolves from a top-level fallback', () => {
    const e = entry({
      id: 'tickets.get',
      method: 'get',
      path: '/api/v1/tickets/{id}',
      parameters: [{ name: 'id', in: 'path', required: true }],
    });
    const req = buildRequest(e, { id: 'a/b c' });
    expect(req.path).toBe('/api/v1/tickets/a%2Fb%20c');
  });

  it('throws fast when a path param cannot be resolved', () => {
    const e = entry({
      id: 'tickets.get',
      method: 'get',
      path: '/api/v1/tickets/{id}',
      parameters: [{ name: 'id', in: 'path', required: true }],
    });
    expect(() => buildRequest(e, {})).toThrow(/Unresolved path parameters for tickets\.get/);
  });
});

describe('buildRequest (T004 — query/body placement + read/mutation classification)', () => {
  it('places query params and classifies GET as a read (no body)', () => {
    const e = entry({
      id: 'tickets.list',
      method: 'get',
      path: '/api/v1/tickets',
      parameters: [{ name: 'limit', in: 'query', required: false }],
    });
    const req = buildRequest(e, { query: { limit: 25 }, body: { ignored: true } });
    expect(req.query).toEqual({ limit: '25' });
    expect(req.isMutation).toBe(false);
    expect(req.body).toBeUndefined(); // body dropped for GET
  });

  it('serializes a JSON body for POST and classifies it as a mutation', () => {
    const e = entry({ id: 'tickets.create', method: 'post', path: '/api/v1/tickets' });
    const req = buildRequest(e, { body: { title: 'Help' } });
    expect(req.method).toBe('POST');
    expect(req.isMutation).toBe(true);
    expect(req.body).toBe('{"title":"Help"}');
  });

  it('honors an explicit method override (e.g. DELETE drops the body)', () => {
    const e = entry({ id: 'tickets.update', method: 'put', path: '/api/v1/tickets/{id}', parameters: [{ name: 'id', in: 'path', required: true }] });
    const req = buildRequest(e, { method: 'delete', path: { id: '7' }, body: { x: 1 } });
    expect(req.method).toBe('DELETE');
    expect(req.isMutation).toBe(true);
    expect(req.body).toBeUndefined(); // DELETE drops the body per chat parity
  });
});
