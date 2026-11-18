import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Contract for binary and attachment content through the hosted `/api/mcp` server:
 * call_api_endpoint never turns binary bodies into text, and read_attachment returns
 * its header first, then native blocks.
 */
vi.mock('@/lib/services/apiKeyServiceForApi', () => ({
  ApiKeyServiceForApi: {
    validateApiKeyAnyTenant: vi.fn(async () => ({ api_key_id: 'k1', tenant: 't-1', user_id: 'u-1' })),
  },
}));
vi.mock('@/lib/features', () => ({ isEnterpriseEdition: () => false }));

import { handleMcpJsonRpc } from '@ee/lib/mcp/jsonRpcServer';

const ID = '11111111-1111-4111-8111-111111111111';

async function rpc(method: string, params?: Record<string, unknown>) {
  const req = new NextRequest('http://localhost/api/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': 'test-key' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  return (await handleMcpJsonRpc(req)).json();
}

afterEach(() => vi.unstubAllGlobals());

describe('hosted MCP binary handling', () => {
  it('call_api_endpoint on a binary response returns the binary:true JSON, not garbled text', async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x80, 0x81, 0xfe]);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(jpeg, { headers: { 'content-type': 'image/jpeg', 'content-length': '7', 'content-disposition': 'inline; filename="IMG_0412.jpg"' } })),
    );
    const body = await rpc('tools/call', {
      name: 'call_api_endpoint',
      arguments: { entryId: 'get-_api_v1_tickets_id_documents_documentid', path: { id: ID, documentId: ID } },
    });
    expect(body.result.isError).toBe(false);
    expect(body.result.content).toHaveLength(1);
    const parsed = JSON.parse(body.result.content[0].text);
    expect(parsed.data).toMatchObject({ binary: true, content_type: 'image/jpeg', byte_length: 7, file_name: 'IMG_0412.jpg' });
    expect(body.result.content[0].text).not.toContain('�');
  });
});

describe('hosted MCP read_attachment', () => {
  it('is listed, calls GET /api/v1/documents/content and returns header first then blocks', async () => {
    const list = await rpc('tools/list');
    expect(list.result.tools.map((t: { name: string }) => t.name)).toContain('read_attachment');

    const header = { entity: { type: 'ticket', id: ID }, served: [], omitted: [], limits_applied: [], remaining: null, next_cursor: null, instructions: 'done' };
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: { header, blocks: [{ type: 'image', data: 'AAAA', mimeType: 'image/jpeg' }] } }), {
          headers: { 'content-type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const body = await rpc('tools/call', { name: 'read_attachment', arguments: { entity_type: 'ticket', entity_id: 'SR000674' } });
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toMatch(/\/api\/v1\/documents\/content\?entity_type=ticket&entity_id=SR000674$/);
    expect(body.result.isError).toBe(false);
    expect(body.result.content.map((b: { type: string }) => b.type)).toEqual(['text', 'image']);
    expect(JSON.parse(body.result.content[0].text)).toEqual(header);
    expect(body.result.structuredContent).toEqual(header);
  });
});
