import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Handler-level regression for the preview SSRF: the stored block data is attacker-controlled;
// DB and cache are stubbed, everything from the handler down to Chromium is real.
let blockData: unknown;
vi.mock('@alga-psa/db', () => ({
  withTransaction: async (_knex: unknown, fn: (trx: unknown) => Promise<unknown>) => fn({}),
  tenantDb: () => ({
    table: () => ({ where: () => ({ first: async () => ({ block_data: blockData }) }) }),
  }),
}));
vi.mock('../src/cache/CacheFactory', () => ({
  CacheFactory: {
    getPreviewCache: () => ({ get: async () => null, set: async () => undefined }),
  },
}));

import { BlockNoteDocumentHandler } from '../src/handlers/BlockNoteDocumentHandler';

let server: http.Server;
let connections = 0;
let port = 0;

beforeAll(async () => {
  server = http.createServer((_req, res) => res.end('x'));
  server.on('connection', () => {
    connections += 1;
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as AddressInfo).port;
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

describe('BlockNote preview of a document whose image points at loopback', () => {
  it('returns a preview and the loopback listener sees no connection', async () => {
    blockData = [
      {
        id: '1',
        type: 'image',
        props: { url: `http://127.0.0.1:${port}/latest/meta-data`, caption: 'internal' },
        content: [],
        children: [],
      },
      { id: '2', type: 'paragraph', content: [{ type: 'text', text: 'hello', styles: {} }], children: [] },
    ];
    connections = 0;
    const handler = new BlockNoteDocumentHandler();
    const result = await handler.generatePreview(
      { document_id: 'doc-1', document_name: 'd' } as any,
      'tenant-1',
      {}
    );
    await new Promise((r) => setTimeout(r, 300));
    expect(result.success).toBe(true);
    expect(result.previewImage).toMatch(/^data:image\/png;base64,/);
    expect(connections).toBe(0);
  }, 60000);
});
