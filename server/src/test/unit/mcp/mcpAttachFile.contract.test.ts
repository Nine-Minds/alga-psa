import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Contract for the hosted `/api/mcp` attach_file tool: tools/list carries the
 * OpenAI file-param _meta and the exact OpenAIFile schema, initialize returns
 * instructions, dispatch posts to /api/v1/documents, and the signed
 * download_url never reaches the audit row or a tool result.
 */
vi.mock('@/lib/services/apiKeyServiceForApi', () => ({
  ApiKeyServiceForApi: {
    validateApiKeyAnyTenant: vi.fn(async () => ({ api_key_id: 'k1', tenant: 't-1', user_id: 'u-1' })),
  },
}));
vi.mock('@/lib/features', () => ({ isEnterpriseEdition: () => false }));

import { handleMcpJsonRpc } from '@ee/lib/mcp/jsonRpcServer';
import { MCP_SERVER_INSTRUCTIONS, OPENAI_FILE_SCHEMA } from '@alga-psa/agent-tooling';

const SIGNED = 'https://files.oaiusercontent.com/file-abc?sig=SECRET-TOKEN';
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

describe('hosted MCP attach_file contract', () => {
  it('initialize returns instructions', async () => {
    const body = await rpc('initialize', {});
    expect(body.result.instructions).toBe(MCP_SERVER_INSTRUCTIONS);
  });

  it('tools/list exposes attach_file with _meta and the exact OpenAIFile schema', async () => {
    const body = await rpc('tools/list');
    const tool = body.result.tools.find((t: any) => t.name === 'attach_file');
    expect(tool._meta).toEqual({ 'openai/fileParams': ['file'] });
    expect(tool.inputSchema.required).not.toContain('file');
    expect(tool.inputSchema.$defs.OpenAIFile).toEqual(JSON.parse(JSON.stringify(OPENAI_FILE_SCHEMA)));
    expect(tool.inputSchema.$defs.OpenAIFile.required).toEqual(['download_url', 'file_id']);
    expect(tool.inputSchema.$defs.OpenAIFile.additionalProperties).toBe(false);
  });

  it('dispatches a file object to POST /api/v1/documents as a url source', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: { document_id: 'd1' } }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    const body = await rpc('tools/call', {
      name: 'attach_file',
      arguments: { entity_type: 'ticket', entity_id: ID, file: { download_url: SIGNED, file_id: 'f1', file_name: 'a.pdf' } },
    });
    expect(body.result.isError).toBe(false);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/api\/v1\/documents$/);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string).source).toEqual({ type: 'url', url: SIGNED });
  });

  it('fails fast on an unusable file without calling the API or echoing the URL', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const body = await rpc('tools/call', {
      name: 'attach_file',
      arguments: { entity_type: 'ticket', entity_id: ID, file: { download_url: 'chat_upload://x?sig=SECRET-TOKEN', file_id: 'f1' } },
    });
    expect(body.result.isError).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(JSON.stringify(body)).not.toContain('SECRET-TOKEN');
  });
});
