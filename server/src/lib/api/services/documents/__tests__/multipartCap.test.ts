import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

vi.mock('@alga-psa/storage/config/storage', () => ({
  getStorageConfig: async () => ({ defaultProvider: 'local', providers: { local: { maxFileSize: 500 * 1024 * 1024 } } }),
}));

import { PayloadTooLargeError } from '../../../middleware/apiErrors';
import { MAX_MULTIPART_REQUEST_BYTES, assertMultipartRequestWithinCap } from '../multipartCap';

const req = (contentLength?: string) => ({ headers: { get: (n: string) => (n === 'content-length' ? contentLength ?? null : null) } });

describe('multipart request cap', () => {
  it('passes at the cap and without a Content-Length', async () => {
    await expect(assertMultipartRequestWithinCap(req(String(MAX_MULTIPART_REQUEST_BYTES)))).resolves.toBeUndefined();
    await expect(assertMultipartRequestWithinCap(req())).resolves.toBeUndefined();
  });

  it('413s past the cap, pointing at the session API', async () => {
    const error = await assertMultipartRequestWithinCap(req(String(MAX_MULTIPART_REQUEST_BYTES + 1))).catch((e) => e);
    expect(error).toBeInstanceOf(PayloadTooLargeError);
    expect(error.message).toMatch(/\/api\/documents\/uploads/);
  });

  it('is clamped to a lower provider max', async () => {
    const error = await assertMultipartRequestWithinCap(req('2048'), 1024).catch((e) => e);
    expect(error).toBeInstanceOf(PayloadTooLargeError);
  });

  it('the ticket multipart path streams the part: no arrayBuffer on the file', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../TicketService.ts'), 'utf8');
    const start = source.indexOf('async uploadTicketDocument(');
    const body = source.slice(start, source.indexOf('async downloadTicketDocument(', start));
    expect(body).not.toContain('.arrayBuffer(');
    expect(body).toContain('file.stream()');
  });
});
