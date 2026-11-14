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
    const url = request.url!;
    if (request.method === 'POST' && url.includes('uploads')) {
      response.setHeader('Content-Type', 'application/xml');
      response.end('<?xml version="1.0"?><InitiateMultipartUploadResult><Bucket>fixture</Bucket><Key>uploads/file</Key><UploadId>fixture-upload</UploadId></InitiateMultipartUploadResult>');
      return;
    }
    if (request.method === 'POST' && url.includes('uploadId=')) {
      response.setHeader('Content-Type', 'application/xml');
      response.end('<?xml version="1.0"?><CompleteMultipartUploadResult><Bucket>fixture</Bucket><Key>uploads/file</Key><ETag>"fixture"</ETag></CompleteMultipartUploadResult>');
      return;
    }
    if (request.method === 'HEAD') { response.setHeader('Content-Length', '5'); response.setHeader('Content-Type', 'text/plain'); }
    response.end();
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  try {
    const provider = new S3StorageProvider({ type: 's3', region: 'us-east-1', bucket: 'fixture', accessKey: 'fixture', secretKey: 'fixture',
      endpoint: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, maxFileSize: 1024, allowedMimeTypes: ['*/*'], retentionDays: 30 });
    const result = await provider.upload(Readable.from([Buffer.from('hello')]), 'uploads/file', { mime_type: 'text/plain' });
    expect(result).toMatchObject({ path: 'uploads/file', size: 5, mime_type: 'text/plain' });
    expect(requests.map(request => request.method)).toEqual(['POST', 'PUT', 'POST', 'HEAD']);
    expect(requests[1].path.split('?')[0]).toBe('/fixture/uploads/file');
    expect(requests[1].path).toContain('partNumber=1');
    expect(requests[1].body.includes(Buffer.from('hello'))).toBe(true);
  } finally {
    server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
