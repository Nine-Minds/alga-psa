import { describe, expect, it } from 'vitest';
import { dispatchMetaTool, type MetaToolTransport } from '../dispatchMetaTool';
import type { BuiltRequest } from '../../invoke/buildRequest';
import type { ChatApiRegistryEntry } from '../../registry/schema';
import { runRegistrySearch } from '../../registry/searchResult';
import { buildRequest } from '../../invoke/buildRequest';
import { buildAttachFileRequest, AttachFileInputError } from '../../invoke/buildAttachFileRequest';
import type { UpstreamBody } from '../../content/readResponseBody';

const REGISTRY: ChatApiRegistryEntry[] = [
  { id: 'tickets.get', method: 'get', path: '/api/v1/tickets/{id}', displayName: 'Get Ticket', tags: ['Tickets'], approvalRequired: false, parameters: [{ name: 'id', in: 'path', required: true }] },
  { id: 'contacts.create', method: 'post', path: '/api/v1/contacts', displayName: 'Create Contact', tags: ['Contacts'], approvalRequired: true, parameters: [] },
];

type Upstream = { status: number; data: unknown };

/**
 * Verbatim copy of the hosted server's pre-refactor `dispatchTool` (jsonRpcServer.ts at 3e5fadef35),
 * with `selfFetch` replaced by a fake that records requests. It is the reference the table must match.
 */
function legacyDispatch(name: string, args: Record<string, unknown>, registry: ChatApiRegistryEntry[], up: Upstream, sent: unknown[], actAs: string | null) {
  const textContent = (data: unknown) => [{ type: 'text' as const, text: JSON.stringify(data ?? null, null, 2) }];
  const toolOk = (data: unknown) => ({ content: textContent(data), isError: false });
  const toolErr = (m: string) => ({ content: textContent({ error: m }), isError: true });
  const resolveEntry = (id: unknown) => {
    const want = String(id ?? '').replace(/-/g, '_');
    if (!want) return null;
    return registry.find((e) => e.id.replace(/-/g, '_') === want) ?? null;
  };
  const selfFetch = (path: string, init: RequestInit, actAsUserId?: string | null) => {
    sent.push({ path, method: init.method, body: init.body, actAs: actAsUserId ?? null, ct: (init.headers as Record<string, string> | undefined)?.['content-type'] ?? null });
    return { status: up.status, ok: up.status < 400, data: up.data };
  };
  if (name === 'search_api_registry') {
    const r = runRegistrySearch(registry, args);
    return r.ok ? toolOk(r.data) : toolErr(r.error);
  }
  if (name === 'search_business_data') {
    const query = typeof args.query === 'string' ? args.query : '';
    if (!query.trim()) return toolErr('search_business_data requires a non-empty "query".');
    const params = new URLSearchParams();
    params.set('query', query);
    if (Array.isArray(args.types) && args.types.length > 0) params.set('types', args.types.map(String).join(','));
    if (args.limit !== undefined && args.limit !== null) params.set('limit', String(args.limit));
    if (args.cursor) params.set('cursor', String(args.cursor));
    if (args.sort) params.set('sort', String(args.sort));
    const r = selfFetch(`/api/v1/search?${params.toString()}`, { method: 'GET' }, actAs);
    return { content: textContent(r.data), isError: !r.ok, statusCode: r.status };
  }
  if (name === 'call_api_endpoint') {
    const entryId = args.entryId;
    if (!entryId || typeof entryId !== 'string') return toolErr('call_api_endpoint requires "entryId" (use search_api_registry first).');
    const entry = resolveEntry(entryId);
    if (!entry) return toolErr(`No registry entry found for entryId "${entryId}".`);
    const built = buildRequest(entry, args);
    const qs = new URLSearchParams(built.query).toString();
    const path = built.path + (qs ? `?${qs}` : '');
    const init: RequestInit = { method: built.method, headers: { ...built.headers } };
    if (built.body !== undefined) {
      (init.headers as Record<string, string>)['content-type'] = 'application/json';
      init.body = built.body;
    }
    const r = selfFetch(path, init, actAs);
    return { content: textContent({ status: r.status, ok: r.ok, data: r.data }), isError: !r.ok, statusCode: r.status };
  }
  if (name === 'attach_file') {
    let built;
    try {
      built = buildAttachFileRequest(args);
    } catch (err) {
      if (err instanceof AttachFileInputError) return toolErr(err.message);
      throw err;
    }
    const r = selfFetch(built.path, { method: built.method, headers: { 'content-type': 'application/json' }, body: built.body });
    return { content: textContent({ status: r.status, ok: r.ok, data: r.data }), isError: !r.ok, statusCode: r.status };
  }
  return toolErr(`Unknown tool: ${name}`);
}

/** The new transport, shaped like the hosted `selfSend`: composes the same path/headers the legacy fake records. */
function fakeTransport(up: Upstream, sent: unknown[]): MetaToolTransport {
  return {
    async send(req: BuiltRequest, opts) {
      const qs = new URLSearchParams(req.query).toString();
      const headers: Record<string, string> = { ...req.headers };
      if (req.body !== undefined) headers['content-type'] = 'application/json';
      sent.push({
        path: req.path + (qs ? `?${qs}` : ''),
        method: req.method,
        body: req.body,
        actAs: opts?.actAsUserId ?? null,
        ct: headers['content-type'] ?? null,
      });
      const body: UpstreamBody = typeof up.data === 'string' ? { kind: 'text', value: up.data } : { kind: 'json', value: up.data };
      return { status: up.status, ok: up.status < 400, body };
    },
  };
}

const SIGNED = 'https://files.oaiusercontent.com/file-abc?sig=SECRET';
const ID = '11111111-1111-4111-8111-111111111111';

const CASES: Array<{ label: string; name: string; args: Record<string, unknown>; up: Upstream; actAs?: string }> = [
  { label: 'registry search hit', name: 'search_api_registry', args: { query: 'get ticket by id' }, up: { status: 200, data: {} } },
  { label: 'registry search missing query', name: 'search_api_registry', args: {}, up: { status: 200, data: {} } },
  { label: 'business search', name: 'search_business_data', args: { query: 'printer', types: ['ticket', 'client'], limit: 5, cursor: 'c', sort: 'recent' }, up: { status: 200, data: { results: [1] } } },
  { label: 'business search act-as', name: 'search_business_data', args: { query: 'x' }, up: { status: 200, data: { results: [] } }, actAs: 'u-1' },
  { label: 'business search empty query', name: 'search_business_data', args: { query: '  ' }, up: { status: 200, data: {} } },
  { label: 'business search 403', name: 'search_business_data', args: { query: 'x' }, up: { status: 403, data: { error: 'nope' } } },
  { label: 'business search text body', name: 'search_business_data', args: { query: 'x' }, up: { status: 502, data: 'Bad gateway' } },
  { label: 'call GET', name: 'call_api_endpoint', args: { entryId: 'tickets.get', path: { id: 'abc' }, query: { fields: 'title' } }, up: { status: 200, data: { data: { id: 'abc' } } } },
  { label: 'call GET act-as', name: 'call_api_endpoint', args: { entryId: 'tickets.get', path: { id: 'abc' } }, up: { status: 200, data: { data: {} } }, actAs: 'u-2' },
  { label: 'call POST', name: 'call_api_endpoint', args: { entryId: 'contacts.create', body: { name: 'A' } }, up: { status: 201, data: { data: { id: 1 } } } },
  { label: 'call 404', name: 'call_api_endpoint', args: { entryId: 'tickets.get', path: { id: 'zz' } }, up: { status: 404, data: { error: { message: 'nf' } } } },
  { label: 'call empty body', name: 'call_api_endpoint', args: { entryId: 'tickets.get', path: { id: 'zz' } }, up: { status: 200, data: '' } },
  { label: 'call missing entryId', name: 'call_api_endpoint', args: {}, up: { status: 200, data: {} } },
  { label: 'call unknown entry', name: 'call_api_endpoint', args: { entryId: 'nope' }, up: { status: 200, data: {} } },
  { label: 'call dash id variant', name: 'call_api_endpoint', args: { entryId: 'tickets-get', path: { id: 'a' } }, up: { status: 200, data: { ok: 1 } } },
  { label: 'attach url', name: 'attach_file', args: { entity_type: 'ticket', entity_id: ID, file: { download_url: SIGNED, file_id: 'f', file_name: 'a.pdf' } }, up: { status: 201, data: { data: { document_id: 'd' } } } },
  { label: 'attach act-as ignored', name: 'attach_file', args: { entity_type: 'ticket', entity_id: ID, url: SIGNED }, up: { status: 201, data: { data: {} } }, actAs: 'u-3' },
  { label: 'attach bad input', name: 'attach_file', args: { entity_type: 'ticket', entity_id: ID, file: SIGNED }, up: { status: 201, data: {} } },
  { label: 'attach 422', name: 'attach_file', args: { entity_type: 'client', entity_id: ID, content_base64: 'aGk=', file_name: 'a.txt' }, up: { status: 422, data: { error: 'bad' } } },
  { label: 'unknown tool', name: 'frobnicate', args: {}, up: { status: 200, data: {} } },
  { label: 'prototype-named tool', name: 'constructor', args: {}, up: { status: 200, data: {} } },
];

describe('dispatchMetaTool: the four existing tools are byte-identical to the pre-refactor dispatch', () => {
  for (const c of CASES) {
    it(c.label, async () => {
      const legacySent: unknown[] = [];
      const newSent: unknown[] = [];
      const legacy = legacyDispatch(c.name, c.args, REGISTRY, c.up, legacySent, c.actAs ?? null);
      const next = await dispatchMetaTool(c.name, c.args, {
        registry: REGISTRY,
        transport: fakeTransport(c.up, newSent),
        actAsUserId: c.actAs ?? null,
      });
      expect(JSON.stringify(next.content)).toBe(JSON.stringify(legacy.content));
      expect(next.isError).toBe(legacy.isError);
      expect(next.statusCode).toBe((legacy as { statusCode?: number }).statusCode);
      expect(next.structuredContent).toBeUndefined();
      expect(newSent).toEqual(legacySent);
    });
  }
});

describe('dispatchMetaTool: binary and read_attachment', () => {
  it('call_api_endpoint on a binary body returns the binary:true JSON, not text', async () => {
    const transport: MetaToolTransport = {
      send: async () => ({ status: 200, ok: true, body: { kind: 'binary', contentType: 'image/jpeg', byteLength: 10, fileName: 'a.jpg' } }),
    };
    const r = await dispatchMetaTool('call_api_endpoint', { entryId: 'tickets.get', path: { id: 'a' } }, { registry: REGISTRY, transport });
    expect(JSON.parse((r.content[0] as { text: string }).text)).toEqual({
      status: 200,
      ok: true,
      data: { binary: true, content_type: 'image/jpeg', byte_length: 10, file_name: 'a.jpg', hint: expect.stringContaining('read_attachment') },
    });
  });

  it('read_attachment sends the built request with act-as and maps the payload header-first', async () => {
    const seen: Array<{ req: BuiltRequest; actAs: unknown }> = [];
    const transport: MetaToolTransport = {
      send: async (req, opts) => {
        seen.push({ req, actAs: opts?.actAsUserId });
        return {
          status: 200,
          ok: true,
          body: { kind: 'json', value: { data: { header: { served: [], omitted: [], next_cursor: null }, blocks: [{ type: 'image', data: 'AAAA', mimeType: 'image/png' }] } } },
        };
      },
    };
    const r = await dispatchMetaTool('read_attachment', { entity_type: 'ticket', entity_id: 'SR000674' }, { registry: [], transport, actAsUserId: 'u' });
    expect(seen[0].req.path).toBe('/api/v1/documents/content');
    expect(seen[0].actAs).toBe('u');
    expect(r.content.map((b) => b.type)).toEqual(['text', 'image']);
    expect(r.structuredContent).toBeDefined();
  });

  it('read_attachment bad input is a tool error and sends nothing', async () => {
    let calls = 0;
    const transport: MetaToolTransport = { send: async () => (calls++, { status: 200, ok: true, body: { kind: 'text', value: '' } }) };
    const r = await dispatchMetaTool('read_attachment', { entity_type: 'ticket' }, { registry: [], transport });
    expect(r.isError).toBe(true);
    expect(calls).toBe(0);
  });

  it('read_attachment 409 surfaces as an error result', async () => {
    const transport: MetaToolTransport = {
      send: async () => ({ status: 409, ok: false, body: { kind: 'json', value: { error: { code: 'CURSOR_STALE' } } } }),
    };
    const r = await dispatchMetaTool('read_attachment', { entity_type: 'ticket', entity_id: 'x', cursor: 'c' }, { registry: [], transport });
    expect(r.isError).toBe(true);
    expect(r.statusCode).toBe(409);
  });
});
