import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { MCP_SERVER_INSTRUCTIONS } from '@alga-psa/agent-tooling';
import { createServer } from '../server';
import type { BuiltRequest } from '@alga-psa/agent-tooling';
import type { InstanceClient } from '../instanceClient';

const SIGNED = 'https://files.oaiusercontent.com/file-abc?sig=SECRET-TOKEN';
const ID = '11111111-1111-4111-8111-111111111111';

async function connect() {
  const sent: BuiltRequest[] = [];
  const client = {
    sendBuilt: async (b: BuiltRequest) => {
      sent.push(b);
      return { status: 201, ok: true, data: { data: { document_id: 'd1' } } };
    },
  } as unknown as InstanceClient;
  const server = createServer({ registry: [], client });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  const mcp = new Client({ name: 't', version: '0' }, { capabilities: {} });
  await mcp.connect(ct);
  return { mcp, sent };
}

describe('connector attach_file', () => {
  it('initialize returns instructions', async () => {
    const { mcp } = await connect();
    expect(mcp.getInstructions()).toBe(MCP_SERVER_INSTRUCTIONS);
  });

  it('tools/list carries _meta and the exact OpenAIFile schema', async () => {
    const { mcp } = await connect();
    const tool = (await mcp.listTools()).tools.find((t) => t.name === 'attach_file') as any;
    expect(tool._meta).toEqual({ 'openai/fileParams': ['file'] });
    expect(tool.inputSchema.$defs.OpenAIFile.required).toEqual(['download_url', 'file_id']);
    expect(tool.inputSchema.$defs.OpenAIFile.additionalProperties).toBe(false);
    expect(tool.inputSchema.required).not.toContain('file');
  });

  it('sends the mapped request through InstanceClient.sendBuilt', async () => {
    const { mcp, sent } = await connect();
    const res: any = await mcp.callTool({
      name: 'attach_file',
      arguments: { entity_type: 'contact', entity_id: ID, file: { download_url: SIGNED, file_id: 'f' } },
    });
    expect(res.isError).toBe(false);
    expect(sent).toHaveLength(1);
    expect(sent[0].path).toBe('/api/v1/documents');
    expect(JSON.parse(sent[0].body as string).source).toEqual({ type: 'url', url: SIGNED });
  });

  it('fails fast without sending and never echoes the signed URL', async () => {
    const { mcp, sent } = await connect();
    const res: any = await mcp.callTool({
      name: 'attach_file',
      arguments: { entity_type: 'ticket', entity_id: ID, file: SIGNED },
    });
    expect(res.isError).toBe(true);
    expect(sent).toHaveLength(0);
    expect(JSON.stringify(res)).not.toContain('SECRET-TOKEN');
  });
});
