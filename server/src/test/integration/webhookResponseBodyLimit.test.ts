import { gzipSync } from 'node:zlib';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MAX_WEBHOOK_RESPONSE_BODY_CHARS } from '@/lib/webhooks/responseBody';
import { sendWithValidatedRedirects } from '@/lib/webhooks/transport';

const listeners: http.Server[] = [];

async function listen(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<{ server: http.Server; port: number }> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.2', resolve));
  listeners.push(server);
  return { server, port: (server.address() as AddressInfo).port };
}

const allowLoopbackAlias = (address: string) => address === '127.0.0.2';

function request(url: string, signal: AbortSignal) {
  return {
    url,
    method: 'GET',
    headers: {},
    body: undefined,
    verifySsl: true,
    signal,
  };
}

describe('webhook response body capture limit', () => {
  const originalAllowPrivate = process.env.WEBHOOK_SSRF_ALLOW_PRIVATE;

  beforeEach(() => {
    delete process.env.WEBHOOK_SSRF_ALLOW_PRIVATE;
  });

  afterEach(async () => {
    if (originalAllowPrivate === undefined) delete process.env.WEBHOOK_SSRF_ALLOW_PRIVATE;
    else process.env.WEBHOOK_SSRF_ALLOW_PRIVATE = originalAllowPrivate;
    await Promise.all(listeners.splice(0).map(async (server) => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }));
  });

  it('captures the exact character boundary and cancels the oversized response stream', async () => {
    let writesAfterCaptureChunk = 0;
    let onClose!: () => void;
    const responseClosed = new Promise<void>((resolve) => { onClose = resolve; });
    const listener = await listen((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.write('a'.repeat(MAX_WEBHOOK_RESPONSE_BODY_CHARS));
      const timer = setInterval(() => {
        if (res.destroyed) {
          clearInterval(timer);
          return;
        }
        writesAfterCaptureChunk += 1;
        res.write('b'.repeat(16 * 1024));
      }, 20);
      res.on('close', () => {
        clearInterval(timer);
        onClose();
      });
    });

    const response = await sendWithValidatedRedirects(
      request(`http://127.0.0.2:${listener.port}/`, AbortSignal.timeout(3000)),
      allowLoopbackAlias,
    );
    await responseClosed;

    expect(response.text).toBe('a'.repeat(MAX_WEBHOOK_RESPONSE_BODY_CHARS));
    expect(response.text.length).toBe(MAX_WEBHOOK_RESPONSE_BODY_CHARS);
    expect(writesAfterCaptureChunk).toBe(0);
  });

  it('decodes a multibyte character split across stream chunks at the capture boundary', async () => {
    const listener = await listen((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      res.write(Buffer.concat([
        Buffer.from('a'.repeat(MAX_WEBHOOK_RESPONSE_BODY_CHARS - 1)),
        Buffer.from([0xc3]),
      ]));
      setTimeout(() => {
        if (!res.destroyed) res.end(Buffer.from([0xa9, 0x7a]));
      }, 20);
    });

    const response = await sendWithValidatedRedirects(
      request(`http://127.0.0.2:${listener.port}/`, AbortSignal.timeout(3000)),
      allowLoopbackAlias,
    );

    expect(response.text).toBe(`${'a'.repeat(MAX_WEBHOOK_RESPONSE_BODY_CHARS - 1)}é`);
  });

  it('bounds compressed expansion after undici decompresses the response', async () => {
    const expanded = Buffer.alloc(MAX_WEBHOOK_RESPONSE_BODY_CHARS * 64, 'c');
    const compressed = gzipSync(expanded);
    expect(compressed.length).toBeLessThan(MAX_WEBHOOK_RESPONSE_BODY_CHARS);
    const listener = await listen((_req, res) => {
      res.writeHead(200, {
        'content-encoding': 'gzip',
        'content-length': compressed.length,
        'content-type': 'text/plain',
      });
      res.end(compressed);
    });

    const response = await sendWithValidatedRedirects(
      request(`http://127.0.0.2:${listener.port}/`, AbortSignal.timeout(3000)),
      allowLoopbackAlias,
    );

    expect(response.text).toBe('c'.repeat(MAX_WEBHOOK_RESPONSE_BODY_CHARS));
    expect(response.text.length).toBe(MAX_WEBHOOK_RESPONSE_BODY_CHARS);
  });

  it('keeps the request timeout active while consuming a response body', async () => {
    const listener = await listen((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.write('partial');
    });

    await expect(sendWithValidatedRedirects(
      request(`http://127.0.0.2:${listener.port}/`, AbortSignal.timeout(100)),
      allowLoopbackAlias,
    )).rejects.toThrow(/timeout|abort/i);
  });

  it('propagates response stream read failures and cancels the body', async () => {
    const listener = await listen((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.write('partial');
      setTimeout(() => res.destroy(new Error('response stream failed')), 20);
    });

    await expect(sendWithValidatedRedirects(
      request(`http://127.0.0.2:${listener.port}/`, AbortSignal.timeout(3000)),
      allowLoopbackAlias,
    )).rejects.toThrow(/response stream failed|terminated/i);
  });
});
