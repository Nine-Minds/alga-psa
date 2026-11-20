import { describe, it, expect } from 'vitest';
import { dispatchMetaTool, type ChatApiRegistryEntry } from '@alga-psa/agent-tooling';
import type { InstanceClient } from '../instanceClient';

// The connector's tool handlers now live in @alga-psa/agent-tooling's dispatchMetaTool; these tests
// drive them through the connector's real transport so the behaviour the connector promised is kept.

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

async function withFetch(response: Response | Error, run: (client: InstanceClient) => Promise<void>) {
  const { InstanceClient: Real } = await import('../instanceClient');
  const { loadConfig } = await import('../config');
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    if (response instanceof Error) throw response;
    return response;
  }) as typeof fetch;
  try {
    await run(new Real(loadConfig({ ALGA_INSTANCE_URL: 'http://alga.test', ALGA_API_TOKEN: 't' } as NodeJS.ProcessEnv)));
  } finally {
    globalThis.fetch = original;
  }
}

const call = (client: InstanceClient, args: Record<string, unknown>) =>
  dispatchMetaTool('call_api_endpoint', args, { registry: REGISTRY, transport: client.transport() });

const textOf = (r: { content: Array<{ type: string; text?: string }> }) => JSON.parse(r.content[0].text as string);

describe('connector call_api_endpoint through dispatchMetaTool', () => {
  it('maps an HTTP failure to isError with the connector\'s described error', async () => {
    await withFetch(new Response('{"error":"not found"}', { status: 404, headers: { 'content-type': 'application/json' } }), async (client) => {
      const r = await call(client, { entryId: 'tickets.get', path: { id: '1' } });
      expect(r.isError).toBe(true);
      expect(textOf(r).status).toBe(404);
      expect(typeof textOf(r).data.error).toBe('string');
    });
  });

  it('returns a successful JSON body as non-error', async () => {
    await withFetch(new Response('{"id":"1"}', { headers: { 'content-type': 'application/json' } }), async (client) => {
      const r = await call(client, { entryId: 'tickets.get', path: { id: '1' } });
      expect(r.isError).toBe(false);
      expect(textOf(r)).toEqual({ status: 200, ok: true, data: { id: '1' } });
    });
  });

  it('returns the binary:true JSON for a binary response, never garbled text', async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
    await withFetch(
      new Response(jpeg, { headers: { 'content-type': 'image/jpeg', 'content-length': String(jpeg.length), 'content-disposition': 'attachment; filename="IMG_1.jpg"' } }),
      async (client) => {
        const r = await call(client, { entryId: 'tickets.get', path: { id: '1' } });
        expect(r.isError).toBe(false);
        expect(r.content).toHaveLength(1);
        expect(textOf(r).data).toMatchObject({ binary: true, content_type: 'image/jpeg', byte_length: 8, file_name: 'IMG_1.jpg' });
        expect(r.content[0].type === 'text' && r.content[0].text).not.toContain('�');
      },
    );
  });

  it('requires entryId and rejects unknown entries', async () => {
    await withFetch(new Response('{}'), async (client) => {
      expect((await call(client, {})).isError).toBe(true);
      expect((await call(client, { entryId: 'nope' })).isError).toBe(true);
    });
  });
});

describe('connector search_api_registry through dispatchMetaTool', () => {
  const noTransport = { send: async () => { throw new Error('must not send'); } };
  it('errors when query is missing', async () => {
    expect((await dispatchMetaTool('search_api_registry', {}, { registry: REGISTRY, transport: noTransport })).isError).toBe(true);
  });
  it('returns ranked results for a match', async () => {
    const r = await dispatchMetaTool('search_api_registry', { query: 'get ticket by id' }, { registry: REGISTRY, transport: noTransport });
    expect(textOf(r).results[0].entryId).toBe('tickets.get');
  });
});
