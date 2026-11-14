import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { IDocument } from '@alga-psa/types';
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { cacheGet, cacheSet, downloadFile, fetchPublicBytes } = vi.hoisted(() => ({
  cacheGet: vi.fn(),
  cacheSet: vi.fn(),
  downloadFile: vi.fn(),
  fetchPublicBytes: vi.fn(),
}));

vi.mock('../cache/CacheFactory', () => ({
  CacheFactory: {
    getPreviewCache: () => ({ get: cacheGet, set: cacheSet }),
  },
}));

vi.mock('@alga-psa/storage/StorageService', () => ({
  StorageService: { downloadFile },
}));

vi.mock('@alga-psa/core/net/safeFetch', () => ({ fetchPublicBytes }));

import { GenericFileDocumentHandler } from './GenericFileDocumentHandler';
import { renderHtmlToPng } from '../lib/renderHtmlToPng';

const PNG_MAGIC = Buffer.from('89504e470d0a1a0a', 'hex');
const FAILURE_SVG = Buffer.from(
  '<svg width="400" height="300"><rect width="100%" height="100%" fill="#e5e7eb"/><text x="20" y="150" fill="#4b5563" font-size="16">Preview unavailable</text></svg>'
);

let listener: http.Server;
let port = 0;
let connections = 0;

beforeAll(async () => {
  listener = http.createServer((_req, res) => res.end('private response'));
  listener.on('connection', () => { connections += 1; });
  await new Promise<void>((resolve) => listener.listen(0, '127.0.0.1', resolve));
  port = (listener.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => listener.close(() => resolve()));
});

beforeEach(() => {
  cacheGet.mockReset().mockResolvedValue(null);
  cacheSet.mockReset().mockResolvedValue(undefined);
  downloadFile.mockReset().mockResolvedValue({ metadata: { original_name: 'fallback.bin', mime_type: 'application/octet-stream' } });
  fetchPublicBytes.mockReset();
  connections = 0;
});

describe('GenericFileDocumentHandler preview filename safety', () => {
  it('renders CSS-looking and markup payloads in document_name as text without resolving them', async () => {
    const fileName = `report url(https://public.example/from-filename).txt </div><iframe src="http://127.0.0.1:${port}/private"></iframe><script>fetch("http://127.0.0.1:${port}/script")</script>`;
    downloadFile.mockResolvedValue({
      metadata: { original_name: fileName, mime_type: 'application/octet-stream' },
    });
    const document = {
      document_id: 'doc-ssrf-regression',
      file_id: 'file-ssrf-regression',
      document_name: fileName,
      mime_type: 'application/octet-stream',
      file_size: 10,
    } as IDocument;

    const result = await new GenericFileDocumentHandler().generatePreview(document, 'tenant-test', {});
    const preview = result.success && result.previewImage
      ? Buffer.from(result.previewImage.split(',')[1], 'base64')
      : Buffer.alloc(0);
    const sharpModule = await import('sharp');
    const sharp = (sharpModule as any).default ?? sharpModule;
    const failurePlaceholder = await sharp(FAILURE_SVG).png().toBuffer();

    expect(downloadFile).toHaveBeenCalledWith('file-ssrf-regression');
    expect(result.success).toBe(true);
    expect(preview.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
    expect(preview.equals(failurePlaceholder)).toBe(false);
    const benignPreview = await renderHtmlToPng({
      kind: 'file-placeholder',
      fileName: 'safe.txt',
      fileType: 'TXT File',
      fileSize: '0 KB',
      icon: '📄',
    });
    expect(preview.equals(benignPreview)).toBe(false);
    expect(fetchPublicBytes).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(connections).toBe(0);
    expect(cacheSet).toHaveBeenCalledOnce();
  }, 60000);
});
