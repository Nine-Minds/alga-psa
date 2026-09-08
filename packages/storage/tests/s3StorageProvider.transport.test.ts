import { expect, it } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import { S3StorageProvider } from '../src/providers/S3StorageProvider';

it('streams through the installed AWS SDK and Node HTTP transport to a loopback endpoint', async () => {
  const requests: { method: string; path: string; body: Buffer }[] = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    requests.push({ method: request.method!, path: request.url!, body: Buffer.concat(chunks) });
    response.setHeader('ETag', '"fixture"');
    if (request.method === 'HEAD') { response.setHeader('Content-Length', '5'); response.setHeader('Content-Type', 'text/plain'); }
    response.end();
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  try {
    const provider = new S3StorageProvider({ type: 's3', region: 'us-east-1', bucket: 'fixture', accessKey: 'fixture', secretKey: 'fixture',
      endpoint: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, maxFileSize: 1024, allowedMimeTypes: ['*/*'], retentionDays: 30 });
    const result = await provider.upload(Readable.from([Buffer.from('hello')]), 'portable-restores/file', { mime_type: 'text/plain', content_length: 5 });
    expect(result).toMatchObject({ path: 'portable-restores/file', size: 5, mime_type: 'text/plain' });
    expect(requests.map(request => request.method)).toEqual(['PUT', 'HEAD']);
    expect(requests[0].path.split('?')[0]).toBe('/fixture/portable-restores/file');
    expect(requests[0].body.includes(Buffer.from('hello'))).toBe(true);
  } finally {
    server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
